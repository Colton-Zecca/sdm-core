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

import { GraphQLPreferenceStore } from "../../../lib/internal/preferences/GraphQLPreferenceStore";
import { assertPreferences } from "./preferences.test";

describe("GraphQLPreferenceStore", () => {

    const ctx = store => ({
        messageClient: {
            send: async msg => {
                store[msg.key] = msg;
            },
        },
        graphClient: {
            query: async opts => {
                if (!!store[opts.variables.key]) {
                    return {
                        SdmPreference: [store[opts.variables.key]],
                    };
                } else {
                    return {
                        SdmPreference: null,
                    };
                }
            },
        },
        configuration: {
            name: "my-sdm",
        },
    });

    it("should correctly handle preferences", async () => {
        const store = {};
        const prefs = new GraphQLPreferenceStore(ctx(store) as any);
        await assertPreferences(prefs, false);
    });

    it("should correctly handle scoped preferences", async () => {
        const store = {};
        const prefs = new GraphQLPreferenceStore(ctx(store) as any);
        await assertPreferences(prefs, true);
    });

});
