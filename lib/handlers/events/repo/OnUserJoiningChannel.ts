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
    GraphQL,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import {
    CredentialsResolver,
    RepoRefResolver,
    UserJoiningChannelListener,
    UserJoiningChannelListenerInvocation,
} from "@atomist/sdm";
import * as schema from "@atomist/sdm/lib/typings/types";

/**
 * A user joined a channel
 */
@EventHandler("On user joining channel", GraphQL.subscription("OnUserJoiningChannel"))
export class OnUserJoiningChannel implements HandleEvent<schema.OnUserJoiningChannel.Subscription> {

    constructor(private readonly listeners: UserJoiningChannelListener[],
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver) {
    }

    public async handle(event: EventFired<schema.OnUserJoiningChannel.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const joinEvent = event.data.UserJoinedChannel[0];
        const repos = joinEvent.channel.repos.map(
            repo => params.repoRefResolver.toRemoteRepoRef(repo, {}));
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, repos[0]);
        const addressChannels = (msg, opts) => context.messageClient.addressChannels(msg, joinEvent.channel.name, opts);
        const invocation: UserJoiningChannelListenerInvocation = {
            addressChannels,
            context,
            credentials,
            joinEvent,
            repos,
        };

        await Promise.all(params.listeners
            .map(l => l(invocation)),
        );
        return Success;
    }
}
