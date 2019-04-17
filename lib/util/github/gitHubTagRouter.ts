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
    configurationValue,
    DefaultHttpClientFactory,
    GitHubRepoRef,
    HttpClientFactory,
    HttpMethod,
    logger,
} from "@atomist/automation-client";
import { successOn } from "@atomist/automation-client/lib/action/ActionResult";
import { isGitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { TagRouter } from "@atomist/automation-client/lib/operations/tagger/Tagger";
import { toToken } from "@atomist/sdm";
import * as _ from "lodash";
import { authHeaders } from "./ghub";

/**
 * Persist tags to GitHub topics
 * @param {Tags} tags
 * @param params params to this command
 * @return {Promise<ActionResult<Tags>>}
 * @constructor
 */
export const GitHubTagRouter: TagRouter = async (tags, params) => {
    const grr = isGitHubRepoRef(tags.repoId) ? tags.repoId : new GitHubRepoRef(tags.repoId.owner, tags.repoId.repo, tags.repoId.sha);
    const url = `${grr.scheme}${grr.apiBase}/repos/${grr.owner}/${grr.repo}/topics`;
    const names = _.uniq(tags.tags);
    const httpClient = configurationValue<HttpClientFactory>("http.client.factory", DefaultHttpClientFactory).create();
    logger.debug(`Request to '${url}' to raise tags: [${names.join()}]`);
    try {
        await httpClient.exchange(url, {
            body: { names },
            headers: {
                ...authHeaders(toToken(params.targets.credentials)).headers,
                Accept: "application/vnd.github.mercy-preview+json",
            },
            method: HttpMethod.Put,
        });
    } catch (e) {
        e.message = `Failed to create GitHub topics '${names.join()}' on '${url}': ${e.message}`;
        logger.error(e.message);
        throw e;
    }
    return successOn(tags);
};
