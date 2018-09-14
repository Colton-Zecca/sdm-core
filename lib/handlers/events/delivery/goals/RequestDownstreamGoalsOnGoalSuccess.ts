/*
 * Copyright © 2018 Atomist, Inc.
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
    EventFired,
    EventHandler,
    GraphQL,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import {
    CredentialsResolver,
    fetchGoalsForCommit,
    GoalImplementationMapper,
    goalKeyString,
    preconditionsAreMet,
    RepoRefResolver,
    SdmGoalEvent,
    SdmGoalFulfillmentMethod,
    SdmGoalKey,
    updateGoal,
} from "@atomist/sdm";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import {
    OnAnySuccessfulSdmGoal,
    SdmGoalState,
} from "../../../../typings/types";

/**
 * Move downstream goals from 'planned' to 'requested' when preconditions are met.
 */
@EventHandler("Move downstream goals from 'planned' to 'requested' when preconditions are met",
    GraphQL.subscription("OnAnySuccessfulSdmGoal"))
export class RequestDownstreamGoalsOnGoalSuccess implements HandleEvent<OnAnySuccessfulSdmGoal.Subscription> {

    constructor(private readonly name,
                private readonly implementationMapper: GoalImplementationMapper,
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsResolver: CredentialsResolver) {
    }

    public async handle(event: EventFired<OnAnySuccessfulSdmGoal.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = params.repoRefResolver.repoRefFromPush(sdmGoal.push);
        const credentials = this.credentialsResolver.eventHandlerCredentials(context, id);

        const goals = await fetchGoalsForCommit(context, id, sdmGoal.repo.providerId, sdmGoal.goalSetId);

        const goalsToRequest = goals.filter(g => isDirectlyDependentOn(sdmGoal, g))
            .filter(g => expectToBeFulfilledAfterRequest(g, this.name))
            .filter(shouldBePlannedOrSkipped)
            .filter(g => preconditionsAreMet(g, { goalsForCommit: goals }));

        if (goalsToRequest.length > 0) {
            logger.info("because %s is successful, these goals are now ready: %s", goalKeyString(sdmGoal),
                goalsToRequest.map(goalKeyString).join(", "));
        }

        /*
         * #294 Intention: for custom descriptions per goal, we need to look up the Goal.
         * This is the only reason to do that here.
         * I want to maintain a list in the SDM of all goals that can be assigned by rules,
         * and pass them here for mapping from SdmGoalKey -> Goal. Then, we can use
         * the requestDescription defined on that Goal.
         */
        await Promise.all(goalsToRequest.map(async goal => {
            const cbs = this.implementationMapper.findFulfillmentCallbackForGoal(goal);
            let g = goal;
            for (const cb of cbs) {
                g = await cb.callback(g, {id, addressChannels: undefined, credentials, context});
            }

            return updateGoal(context, g, {
                state: SdmGoalState.requested,
                description: `Ready to ` + g.name,
                data: g.data,
            });
        }));
        return Success;
    }
}

function shouldBePlannedOrSkipped(dependentGoal: SdmGoalEvent) {
    if (dependentGoal.state === SdmGoalState.planned) {
        return true;
    }
    if (dependentGoal.state === SdmGoalState.skipped) {
        logger.info("Goal %s was skipped, but now maybe it can go", dependentGoal.name);
        return true;
    }
    if (dependentGoal.state === SdmGoalState.failure && dependentGoal.retryFeasible) {
        logger.info("Goal %s failed, but maybe we will retry it", dependentGoal.name);
        return true;
    }
    logger.warn("Goal %s in state %s will not be requested", dependentGoal.name, dependentGoal.state);
    return false;
}

function expectToBeFulfilledAfterRequest(dependentGoal: SdmGoalEvent, name: string) {
    switch (dependentGoal.fulfillment.method) {
        case SdmGoalFulfillmentMethod.Sdm:
            return true;
        case SdmGoalFulfillmentMethod.SideEffect:
            return dependentGoal.fulfillment.name !== name;
        case SdmGoalFulfillmentMethod.Other:
            // legacy behavior
            return true;
    }
}

function mapKeyToGoal<T extends SdmGoalKey>(goals: T[]): (SdmGoalKey) => T {
    return (keyToFind: SdmGoalKey) => {
        const found = goals.find(g =>
            g.environment === keyToFind.environment &&
            g.name === keyToFind.name);
        return found;
    };
}

function isDirectlyDependentOn(successfulGoal: SdmGoalKey, goal: SdmGoalEvent): boolean {
    if (!goal) {
        logger.warn("Internal error: Trying to work out if %j is dependent on null or undefined goal", successfulGoal);
        return false;
    }
    if (!goal.preConditions || goal.preConditions.length === 0) {
        return false; // no preconditions? not dependent
    }
    if (mapKeyToGoal(goal.preConditions)(successfulGoal)) {
        logger.debug("%s depends on %s", goal.name, successfulGoal.name);
        return true; // the failed goal is one of my preconditions? dependent
    }
    return false;
}
