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
    GitHubRepoRef,
    logger,
} from "@atomist/automation-client";
import {
    GoalCompletionListener,
    GoalCompletionListenerInvocation,
    goalKeyString,
    GoalsSetListener,
    GoalsSetListenerInvocation,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    StatusState,
} from "@atomist/sdm";
import { SdmGoalState } from "../../typings/types";
import { createStatus } from "../../util/github/ghub";

export function createPendingGitHubStatusOnGoalSet(sdm: SoftwareDeliveryMachine): GoalsSetListener {
    return async (inv: GoalsSetListenerInvocation) => {
        const { id, credentials } = inv;
        if (inv.goalSet && inv.goalSet.goals && inv.goalSet.goals.length > 0) {
            logger.info("Created goal set '%s'. Creating in progress GitHub status", inv.goalSetId);
            return createStatus(credentials, id as GitHubRepoRef, {
                context: context(sdm),
                description: `${prefix(sdm)} in progress`,
                target_url: "https://app.atomist.com", // TODO: deep link!
                state: "pending",
            });
        } else {
            logger.info("No goals planned. Not creating in progress GitHub status");
            return Promise.resolve();
        }
    };
}

export function setGitHubStatusOnGoalCompletion(sdm: SoftwareDeliveryMachine): GoalCompletionListener {
    return async (inv: GoalCompletionListenerInvocation) => {
        const { id, completedGoal, allGoals, credentials } = inv;
        logger.info("Completed goal: '%s' with '%s' in set '%s'",
            goalKeyString(completedGoal), completedGoal.state, completedGoal.goalSetId);

        if (completedGoal.state === "failure") {
            logger.info("Setting GitHub status to failed on %s", id.sha);
            return createStatus(credentials, id as GitHubRepoRef, {
                context: context(sdm),
                description: `${prefix(sdm)}: ${completedGoal.description}`,
                target_url: completedGoal.url, // link to the log of the failed goal
                state: "failure",
            });
        }
        if (allSuccessful(allGoals)) {
            logger.info("Setting GitHub status to success on %s", id.sha);
            return createStatus(credentials, id as GitHubRepoRef, {
                context: context(sdm),
                description: `${prefix(sdm)}: all succeeded`,
                target_url: "https://app.atomist.com", // TODO: deep link!
                state: "success",
            });
        }
    };
}

function allSuccessful(goals: SdmGoalEvent[]): boolean {
    goals.forEach(g => logger.debug("goal %s is %s", g.name, g.state));
    return !goals.some(g => g.state !== "success");
}

export function sdmGoalStateToGitHubStatusState(goalState: SdmGoalState): StatusState {
    switch (goalState) {
        case SdmGoalState.planned:
        case SdmGoalState.requested:
        case SdmGoalState.in_process:
        case SdmGoalState.waiting_for_approval:
        case SdmGoalState.waiting_for_pre_approval:
        case SdmGoalState.approved:
        case SdmGoalState.pre_approved:
            return "pending" as StatusState;
        case SdmGoalState.success:
            return "success" as StatusState;
        case SdmGoalState.failure:
        case SdmGoalState.skipped:
        case SdmGoalState.stopped:
        case SdmGoalState.canceled:
            return "failure" as StatusState;
        default:
            throw new Error("Unknown goal state " + goalState);
    }
}

function prefix(sdm: SoftwareDeliveryMachine): string {
    return sdm.name && sdm.name.length > 0 ? `${sdm.name} goals` : "Atomist SDM goals";
}

function context(sdm: SoftwareDeliveryMachine): string {
    return `sdm/${sdm.configuration.name.replace("@", "")}`;
}