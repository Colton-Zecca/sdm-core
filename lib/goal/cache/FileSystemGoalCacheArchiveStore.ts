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
    CacheConfiguration,
    GoalInvocation,
    spawnLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import { GoalCacheArchiveStore } from "./CompressingGoalCache";

/**
 * Goal archive store that stores the compressed archives into the SDM cache directory.
 */
export class FileSystemGoalCacheArchiveStore implements GoalCacheArchiveStore {
    public async store(gi: GoalInvocation, classifier: string, archivePath: string): Promise<void> {
        const cacheDir = await FileSystemGoalCacheArchiveStore.getCacheDirectory(gi, classifier);
        const archiveName = FileSystemGoalCacheArchiveStore.getArchiveName(gi);
        const archiveFileName = path.join(cacheDir, archiveName);
        await spawnLog("mv", [archivePath, archiveFileName], {
            log: gi.progressLog,
        });
    }

    public async delete(gi: GoalInvocation, classifier: string): Promise<void> {
        const cacheDir = await FileSystemGoalCacheArchiveStore.getCacheDirectory(gi, classifier);
        const archiveName = FileSystemGoalCacheArchiveStore.getArchiveName(gi);
        const archiveFileName = path.join(cacheDir, archiveName);
        await spawnLog("rm", ["-f", archiveFileName], {
            log: gi.progressLog,
        });
    }

    public async retrieve(gi: GoalInvocation, classifier: string, targetArchivePath: string): Promise<void> {
        const cacheDir = await FileSystemGoalCacheArchiveStore.getCacheDirectory(gi, classifier);
        const archiveName = FileSystemGoalCacheArchiveStore.getArchiveName(gi);
        const archiveFileName = path.join(cacheDir, archiveName);
        await spawnLog("cp", [archiveFileName, targetArchivePath], {
            log: gi.progressLog,
        });
    }

    private static async getCacheDirectory(gi: GoalInvocation, classifier: string = "default"): Promise<string> {
        const possibleCacheConfiguration = gi.configuration.sdm.cache as (CacheConfiguration["cache"] | undefined);
        const sdmCacheDir = possibleCacheConfiguration ? (possibleCacheConfiguration.path || "/opt/data") : "/opt/data";
        const cacheDir = path.join(sdmCacheDir, classifier);
        await fs.mkdirs(cacheDir);
        return cacheDir;
    }

    private static getArchiveName(gi: GoalInvocation): string {
        return `${gi.goalEvent.sha}-cache.tar.gz`;
    }
}
