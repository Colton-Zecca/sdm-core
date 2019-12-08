/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    automationClientInstance,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    cancelableGoal,
    descriptionFromState,
    executeGoal,
    ExecuteGoalResult,
    formatDate,
    GoalExecutionListener,
    GoalImplementationMapper,
    GoalInvocation,
    GoalScheduler,
    isGoalCanceled,
    LoggingProgressLog,
    ProgressLog,
    resolveCredentialsPromise,
    SdmGoalEvent,
    SdmGoalState,
    serializeResult,
    SoftwareDeliveryMachineConfiguration,
    updateGoal,
    WriteToAllProgressLog,
} from "@atomist/sdm";
import { SdmGoalFulfillmentMethod } from "@atomist/sdm/lib/api/goal/SdmGoalMessage";
import * as os from "os";
import { shouldFulfill } from "../../../../internal/delivery/goals/support/validateGoal";
import { verifyGoal } from "../../../../internal/signing/goalSigning";
import { OnAnyRequestedSdmGoal } from "../../../../typings/types";
import { formatDuration } from "../../../../util/misc/time";

/**
 * Handle an SDM request goal. Used for many implementation types.
 */
@EventHandler("Fulfill a goal when it reaches 'requested' state",
    GraphQL.subscription("OnAnyRequestedSdmGoal"))
export class FulfillGoalOnRequested implements HandleEvent<OnAnyRequestedSdmGoal.Subscription> {

    @Value("") // empty path returns the entire configuration
    public configuration: SoftwareDeliveryMachineConfiguration;

    constructor(private readonly implementationMapper: GoalImplementationMapper,
                private readonly goalExecutionListeners: GoalExecutionListener[]) {
    }

    /* tslint:disable:cyclomatic-complexity */
    public async handle(event: EventFired<OnAnyRequestedSdmGoal.Subscription>,
                        ctx: HandlerContext): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!shouldFulfill(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.uniqueName} skipped because not fulfilled by this SDM`);
            return Success;
        }

        await verifyGoal(sdmGoal, this.configuration.sdm.goalSigning, ctx);

        if ((await cancelableGoal(sdmGoal, this.configuration)) && (await isGoalCanceled(sdmGoal, ctx))) {
            logger.debug(`Goal ${sdmGoal.uniqueName} has been canceled. Not fulfilling`);
            return Success;
        }

        if (sdmGoal.fulfillment.method === SdmGoalFulfillmentMethod.SideEffect &&
            sdmGoal.fulfillment.registration !== this.configuration.name) {
            logger.debug("Not fulfilling side-effected goal '%s' with method '%s/%s'",
                sdmGoal.uniqueName, sdmGoal.fulfillment.method, sdmGoal.fulfillment.name);
            return Success;
        } else if (sdmGoal.fulfillment.method === SdmGoalFulfillmentMethod.Other) {
            // fail goal with neither Sdm nor SideEffect fulfillment
            await updateGoal(
                ctx,
                sdmGoal,
                {
                    state: SdmGoalState.failure,
                    description: `No fulfillment for ${sdmGoal.uniqueName}`,
                });
            return Success;
        }

        const id = this.configuration.sdm.repoRefResolver.repoRefFromSdmGoal(sdmGoal);
        const credentials = await resolveCredentialsPromise(this.configuration.sdm.credentialsResolver.eventHandlerCredentials(ctx, id));
        const addressChannels = addressChannelsFor(sdmGoal.push.repo, ctx);
        const preferences = this.configuration.sdm.preferenceStoreFactory(ctx);

        const implementation = this.implementationMapper.findImplementationBySdmGoal(sdmGoal);
        const { goal } = implementation;

        const progressLog = new WriteToAllProgressLog(
            sdmGoal.name,
            new LoggingProgressLog(sdmGoal.name, "debug"),
            await this.configuration.sdm.logFactory(ctx, sdmGoal));

        const goalInvocation: GoalInvocation = {
            configuration: this.configuration,
            sdmGoal,
            goalEvent: sdmGoal,
            goal,
            progressLog,
            context: ctx,
            addressChannels,
            preferences,
            id,
            credentials,
            parameters: !!event.data.SdmGoal[0].parameters ? JSON.parse(event.data.SdmGoal[0].parameters) : {},
        };

        const goalScheduler = await findGoalScheduler(goalInvocation, this.configuration);
        if (!!goalScheduler) {
            const start = Date.now();
            const result = await goalScheduler.schedule(goalInvocation);
            if (!!result && result.code !== undefined && result.code !== 0) {
                await updateGoal(ctx, sdmGoal, {
                    state: SdmGoalState.failure,
                    description: `Failed to schedule goal`,
                    url: progressLog.url,
                });
                await reportEndAndClose(result, start, progressLog);
            } else {
                await updateGoal(ctx, sdmGoal, {
                    state: !!result && !!result.state ? result.state : SdmGoalState.in_process,
                    phase: !!result && !!result.phase ? result.phase : "scheduled",
                    description: !!result && !!result.description ? result.description : descriptionFromState(goal, SdmGoalState.in_process, sdmGoal),
                    url: progressLog.url,
                    externalUrls: !!result ? result.externalUrls : undefined,
                });
            }
            return {
                ...result as any,
                // successfully handled event even if goal failed
                code: 0,
            };
        } else {
            delete (sdmGoal as any).id;

            await reportStart(sdmGoal, progressLog);
            const start = Date.now();

            try {
                const result = await executeGoal(
                    {
                        projectLoader: this.configuration.sdm.projectLoader,
                        goalExecutionListeners: this.goalExecutionListeners,
                    },
                    implementation,
                    goalInvocation);
                const terminatingStates = [
                    SdmGoalState.canceled,
                    SdmGoalState.failure,
                    SdmGoalState.skipped,
                    SdmGoalState.stopped,
                    SdmGoalState.success,
                    SdmGoalState.waiting_for_approval,
                ];
                if (!result || !result.state || terminatingStates.includes(result.state)) {
                    await reportEndAndClose(result, start, progressLog);
                }
                return {
                    ...result,
                    // successfully handled event even if goal failed
                    code: 0,
                };
            } catch (e) {
                e.message = `Goal executor threw exception: ${e.message}`;
                const egr: ExecuteGoalResult = {
                    code: 1,
                    message: e.message,
                    state: SdmGoalState.failure,
                };
                await reportEndAndClose(egr, start, progressLog);
                throw e;
            }
        }
    }
    /* tslint:enable:cyclomatic-complexity */
}

async function findGoalScheduler(gi: GoalInvocation, configuration: SoftwareDeliveryMachineConfiguration): Promise<GoalScheduler | undefined> {
    let goalSchedulers: GoalScheduler[];
    if (!configuration.sdm.goalScheduler) {
        return undefined;
    } else if (!Array.isArray(configuration.sdm.goalScheduler)) {
        goalSchedulers = [configuration.sdm.goalScheduler];
    } else {
        goalSchedulers = configuration.sdm.goalScheduler;
    }
    for (const gl of goalSchedulers) {
        if (await gl.supports(gi)) {
            return gl;
        }
    }
    return undefined;
}

async function reportStart(sdmGoal: SdmGoalEvent, progressLog: ProgressLog): Promise<void> {
    progressLog.write(`/--`);
    progressLog.write(`Start: ${formatDate(new Date(), "yyyy-mm-dd HH:MM:ss.l")}`);
    progressLog.write(`Repository: ${sdmGoal.push.repo.owner}/${sdmGoal.push.repo.name}/${sdmGoal.branch}`);
    progressLog.write(`Sha: ${sdmGoal.sha}`);
    progressLog.write(`Goal: ${sdmGoal.name} (${sdmGoal.uniqueName})`);
    progressLog.write(`Environment: ${sdmGoal.environment.slice(2)}`);
    progressLog.write(`GoalSet: ${sdmGoal.goalSet} - ${sdmGoal.goalSetId}`);
    progressLog.write(`Host: ${os.hostname()}`);
    progressLog.write(
        `SDM: ${automationClientInstance().configuration.name}:${automationClientInstance().configuration.version}`);
    progressLog.write("\\--");
    await progressLog.flush();
}

async function reportEndAndClose(result: ExecuteGoalResult, start: number, progressLog: ProgressLog): Promise<void> {
    progressLog.write(`/--`);
    progressLog.write(`Result: ${serializeResult(result)}`);
    progressLog.write(`Duration: ${formatDuration(Date.now() - start)}`);
    progressLog.write(`Finish: ${formatDate(new Date(), "yyyy-mm-dd HH:MM:ss.l")}`);
    progressLog.write("\\--");
    await progressLog.close();
}
