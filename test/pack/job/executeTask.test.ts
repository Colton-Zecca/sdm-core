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
    EventFired,
    HandlerContext,
    HandlerResult,
    MappedParameter,
    Parameter,
    Secret,
    Secrets,
    Success,
} from "@atomist/automation-client";
import { defaultConfiguration } from "@atomist/automation-client/lib/configuration";
import {
    CommandHandler,
    MappedParameters,
} from "@atomist/automation-client/lib/decorators";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { BuildableAutomationServer } from "@atomist/automation-client/lib/server/BuildableAutomationServer";
import * as _ from "lodash";
import * as assert from "power-assert";
import { JobTaskType } from "../../../lib/pack/job/createJob";
import { ExecuteTaskListener } from "../../../lib/pack/job/executeTask";
import {
    AtmJobTaskState,
    OnAnyJobTask,
} from "../../../lib/typings/types";

describe("executeTask", () => {

    afterEach(() => {
        delete (global as any).__runningAutomationClient;
    });

    const event: EventFired<OnAnyJobTask.Subscription> = {
        data: {
            AtmJobTask: [{
                name: "TestCommand",
                state: AtmJobTaskState.created,
                job: {
                    data: "{}",
                },
                data: JSON.stringify({
                    type: JobTaskType.Command,
                }),
            }],
        },
        extensions: {
            operationName: "ExecuteTask",
        },
        secrets: [],
    };

    it("should fail if command can't be found", async () => {
        const server = new BuildableAutomationServer(defaultConfiguration());
        (global as any).__runningAutomationClient = {
            automationServer: server,
        };

        const result = await ExecuteTaskListener(
            event,
            {
                graphClient: {
                    mutate: async options => {
                        const vars = options.variables;
                        assert.strictEqual(vars.state.state, AtmJobTaskState.failed);
                        assert.strictEqual(vars.state.message, "Task command 'TestCommand' could not be found");
                        return {};
                    },
                },
            } as any, {});
        assert.strictEqual(result.code, 0);
    });

    it("should invoke with correctly bound parameters", async () => {
        const server = new BuildableAutomationServer(defaultConfiguration());
        (global as any).__runningAutomationClient = {
            automationServer: server,
        };
        server.registerCommandHandler(() => new TestCommand());

        const e = _.merge(
            {},
            event,
            {
                data: {
                    AtmJobTask: [{
                        data: JSON.stringify({
                            type: JobTaskType.Command,
                            parameters: {
                                param: "bar",
                                owner: "atomist",
                                token: "123456",
                            },
                        }),
                    }],
                },
            });

        const result = await ExecuteTaskListener(
            e,
            {
                graphClient: {
                    mutate: async options => {
                        const vars = options.variables;
                        assert.strictEqual(vars.state.state, AtmJobTaskState.success);
                        return {};
                    },
                },
            } as any, {});
        assert.strictEqual(result.code, 0);
    });

});

@CommandHandler("Some test command")
class TestCommand implements HandleCommand {

    @Parameter()
    public param: string;

    @Secret(Secrets.UserToken)
    public token: string;

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {
        assert.strictEqual(this.param, "bar");
        assert.strictEqual(this.owner, "atomist");
        assert.strictEqual(this.token, "123456");
        return Success;
    }
}