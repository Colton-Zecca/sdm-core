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
    AutomationContextAware,
    configurationValue,
    HandlerContext,
    MutationNoCacheOptions,
    ParameterType,
} from "@atomist/automation-client";
import * as _ from "lodash";
import { CreateJob } from "../../typings/types";

export interface JobTask<T extends ParameterType> {
    name: string;
    parameters: T;
}

/**
 * Create a AtmJob in the backend with the provided name and tasks
 */
export async function createJob<T extends ParameterType>(name: string,
                                                         tasks: Array<JobTask<T>>,
                                                         ctx: HandlerContext): Promise<{ id: string }> {
    const context = ctx as any as AutomationContextAware;
    const owner = _.get(context, "context.name") || configurationValue<string>("name");
    const data = JSON.stringify(_.get(context, "trigger") || {});

    const result = await ctx.graphClient.mutate<CreateJob.Mutation, CreateJob.Variables>({
        name: "CreateJob",
        variables: {
            name,
            owner,
            data,
            tasks: tasks.map(t => ({
                name: t.name,
                data: JSON.stringify({
                    parameters: t.parameters,
                }),
            })),
        },
        options: MutationNoCacheOptions,
    });

    return { id: result.createAtmJob.id };
}
