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
    GraphQL,
    HandlerContext,
    logger,
    OnEvent,
    Success,
} from "@atomist/automation-client";
import { redact } from "@atomist/automation-client/lib/util/redact";
import {
    EventHandlerRegistration,
    JobTask,
    JobTaskType,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import {
    AtmJobTaskState,
    OnAnyJobTask,
    SetJobTaskState,
} from "../../typings/types";
import {
    prepareCommandInvocation,
    prepareHandlerContext,
} from "./helpers";

/**
 * Execute an incoming job task event
 */
export function executeTask(sdm: SoftwareDeliveryMachine): EventHandlerRegistration<OnAnyJobTask.Subscription> {
    return {
        name: "ExecuteTask",
        description: "Execute a job task",
        subscription: GraphQL.subscription({
            name: "OnAnyJobTask",
            variables: {
                registration: sdm.configuration.name,
            },
        }),
        listener: ExecuteTaskListener,
    };
}

export const ExecuteTaskListener: OnEvent<OnAnyJobTask.Subscription> = async (e, ctx) => {
    const task = e.data.AtmJobTask[0];

    if (task.state === AtmJobTaskState.created) {
        let jobData: any;
        let taskData: JobTask<any>;

        try {
            jobData = JSON.parse(task.job.data);
            taskData = JSON.parse(task.data) as JobTask<any>;
        } catch (e) {
            logger.warn("Parsing of job or task data failed: %s", e.message);
            await updateJobTaskState(
                task.id,
                AtmJobTaskState.failed,
                redact(`Task command '${task.name}' failed: ${e.message}`),
                ctx);
        }

        if (taskData.type === JobTaskType.Command) {
            const md = automationClientInstance().automationServer.automations.commands
                .find(c => c.name === task.name);

            if (!md) {
                await updateJobTaskState(
                    task.id,
                    AtmJobTaskState.failed,
                    `Task command '${task.name}' could not be found`,
                    ctx);
            } else {
                try {
                    // Invoke the command
                    const result = await automationClientInstance().automationServer.invokeCommand(
                        prepareCommandInvocation(md, taskData.parameters),
                        prepareHandlerContext(ctx, jobData),
                    );

                    // Handle result
                    if (!!result && result.code !== undefined) {
                        if (result.code === 0) {
                            await updateJobTaskState(
                                task.id,
                                AtmJobTaskState.success,
                                `Task command '${task.name}' successfully executed`,
                                ctx);
                        } else {
                            await updateJobTaskState(
                                task.id,
                                AtmJobTaskState.failed,
                                redact(result.message || `Task command '${task.name}' failed`),
                                ctx);
                        }
                    } else {
                        await updateJobTaskState(
                            task.id,
                            AtmJobTaskState.success,
                            `Task command '${task.name}' successfully executed`,
                            ctx);
                    }
                } catch (e) {
                    logger.warn("Command execution failed: %s", e.message);
                    await updateJobTaskState(
                        task.id,
                        AtmJobTaskState.failed,
                        redact(`Task command '${task.name}' failed: ${e.message}`),
                        ctx);
                }
            }
        }
    }

    return Success;
};

/**
 * Update the job task status
 */
async function updateJobTaskState(id: string,
                                  state: AtmJobTaskState,
                                  message: string,
                                  ctx: HandlerContext): Promise<void> {
    await ctx.graphClient.mutate<SetJobTaskState.Mutation, SetJobTaskState.Variables>({
        name: "SetJobTaskState",
        variables: {
            id,
            state: {
                state,
                message,
            },
        },
    });
}
