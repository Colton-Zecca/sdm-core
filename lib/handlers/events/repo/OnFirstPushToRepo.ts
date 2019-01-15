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
    GitCommandGitProject,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    AddressChannels,
    AddressNoChannels,
    CredentialsResolver,
    PreferenceStoreFactory,
    PushListener,
    PushListenerInvocation,
    RepoRefResolver,
} from "@atomist/sdm";
import * as _ from "lodash";
import * as schema from "../../../typings/types";

/**
 * A new repo has been created, and it has some code in it.
 */
@EventHandler("On repo creation", GraphQL.subscription("OnFirstPushToRepo"))
export class OnFirstPushToRepo
    implements HandleEvent<schema.OnFirstPushToRepo.Subscription> {

    constructor(private readonly actions: PushListener[],
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<schema.OnFirstPushToRepo.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const push = event.data.Push[0];

        if (!!push.before) {
            logger.debug(`Done: Not a new commit on ${push.repo.name}`);
            return Success;
        }

        if (push.branch !== push.repo.defaultBranch) {
            logger.debug(`Done: Not push to the default branch on ${push.repo.name}`);
            return Success;
        }

        const screenName = _.get(push, "after.committer.person.chatId.screenName");
        const id = this.repoRefResolver.toRemoteRepoRef(push.repo, { sha: push.after.sha });
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, id);
        const preferences = this.preferenceStoreFactory(context);

        let addressChannels: AddressChannels;
        if (!screenName) {
            logger.warn("Warning: Cannot get screen name of committer for first push on %j", id);
            addressChannels = AddressNoChannels;
        } else {
            addressChannels = m => context.messageClient.addressUsers(m, screenName);
        }

        const project = await GitCommandGitProject.cloned(credentials, id);
        const invocation: PushListenerInvocation = {
            id,
            context,
            addressChannels,
            preferences,
            credentials,
            project,
            push,
        };
        await Promise.all(this.actions
            .map(l => l(invocation)),
        );
        return Success;
    }
}
