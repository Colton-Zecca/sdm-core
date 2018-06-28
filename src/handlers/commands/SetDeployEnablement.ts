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

import { failure, HandlerResult, MappedParameter, MappedParameters, Success } from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { HandlerContext } from "@atomist/automation-client/Handlers";
import { addressEvent } from "@atomist/automation-client/spi/message/MessageClient";
import { CommandHandlerRegistration } from "@atomist/sdm";
import { DeployEnablementRootType, SdmDeployEnablement } from "../../ingesters/sdmDeployEnablement";
import { success } from "../../util/slack/messages";

@Parameters()
export class SetDeployEnablementParameters {

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

}

/**
 * Command to set deploy enablement on the currently mapped repo
 * @param {boolean} enable
 * @return {(ctx: HandlerContext, params: SetDeployEnablementParameters) => Promise<HandlerResult>}
 */
export function setDeployEnablement(enable: boolean) {
    return (ctx: HandlerContext, params: SetDeployEnablementParameters): Promise<HandlerResult> => {
        const deployEnablement: SdmDeployEnablement = {
            state: enable ? "requested" : "disabled",
            owner: params.owner,
            repo: params.repo,
            providerId: params.providerId,
        };
        return ctx.messageClient.send(deployEnablement, addressEvent(DeployEnablementRootType))
            .then(() => ctx.messageClient.respond(
                success(
                    "Deploy Enablement",
                    `Successfully ${enable ? "enabled" : "disabled"} deployment`)))
            .then(() => Success, failure);
    };
}

export const EnableDeploy: CommandHandlerRegistration<SetDeployEnablementParameters> = {
    name: "EnableDeploy",
    intent: "enable deploy",
    description: "Enable deployment via Atomist SDM",
    paramsMaker: SetDeployEnablementParameters,
    listener: async () => setDeployEnablement(true),
};

export const DisableDeploy: CommandHandlerRegistration<SetDeployEnablementParameters> = {
    name: "DisableDeploy",
    intent: "disable deploy",
    description: "Disable deployment via Atomist SDM",
    paramsMaker: SetDeployEnablementParameters,
    listener: async () => setDeployEnablement(false),
};
