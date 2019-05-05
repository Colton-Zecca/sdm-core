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

import { HandlerContext } from "@atomist/automation-client";
import { PreferenceStoreFactory } from "@atomist/sdm";
import {
    AbstractPreferenceStore,
    Preference,
} from "./AbstractPreferenceStore";

/**
 * Factory to create a new InMemoryPreferenceStore instance
 */
export const InMemoryPreferenceStoreFactory: PreferenceStoreFactory = ctx => new InMemoryPreferenceStore(ctx);

/**
 * PreferenceStore implementation that simply stores preferences in-memory.
 * Note: This is implementation is not intended for production usage.
 */
export class InMemoryPreferenceStore extends AbstractPreferenceStore {

    private readonly store: { [key: string]: Preference } = {};

    constructor(private readonly context: HandlerContext) {
        super(context);
    }

    protected async doGet(name: string, namespace: string): Promise<Preference | undefined> {
        const key = this.scopeKey(name, namespace);
        return this.store[key];
    }

    protected async doPut(pref: Preference): Promise<void> {
        const key = this.scopeKey(pref.name, pref.namespace);
        this.store[key] = {
            ...pref,
            ttl: typeof pref.ttl === "number" ? Date.now() + pref.ttl : undefined,
        };
    }
}
