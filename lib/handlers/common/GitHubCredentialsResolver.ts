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
    Secret,
    Secrets,
    Value,
} from "@atomist/automation-client/lib/decorators";
import { ProjectOperationCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import { CredentialsResolver } from "@atomist/sdm";

export class GitHubCredentialsResolver implements CredentialsResolver {

    @Secret(Secrets.OrgToken)
    private readonly orgToken: string;

    @Value({ path: "token", required: false, type: "string" })
    private readonly clientToken: string;

    public eventHandlerCredentials(): ProjectOperationCredentials {
        return this.credentials();
    }

    public commandHandlerCredentials(): ProjectOperationCredentials {
        return this.credentials();
    }

    private credentials() {
        if (this.hasToken(this.orgToken)) {
            return { token: this.orgToken };
        } else if (this.hasToken(this.clientToken)) {
            return { token: this.clientToken };
        }
        throw new Error("Neither 'orgToken' nor 'clientToken' has been injected. " +
            "Please add a repo-scoped GitHub token to your configuration.");
    }

    private hasToken(token: string) {
        if (!token) {
            return false;
        } else if (token === "null") { // "null" as string is being sent when the orgToken can't be determined by the api
            return false;
        }
        return true;
    }

}
