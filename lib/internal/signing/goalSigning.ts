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
    AutomationEventListenerSupport,
    CustomEventDestination,
    Destination,
    HandlerContext,
    logger,
    MessageOptions,
} from "@atomist/automation-client";
import {
    GoalSigningConfiguration,
    GoalVerificationKey,
    SdmGoalEvent,
    SdmGoalMessage,
    SdmGoalState,
    SdmProvenance,
    updateGoal,
} from "@atomist/sdm";
import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import { DeepPartial } from "ts-essentials";

export interface SignatureMixin {
    signature: string;
}

/**
 * AutomationEventListener that verifies incoming SDM goals against a set of configurable
 * verification public keys.
 *
 * Optionally a private key can be specified to sign outgoing goals. Setting this is strongly
 * recommended to prevent executing untrusted and/or tampered SDM goals.
 */
export class GoalSigningAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly gsc: GoalSigningConfiguration) {
        super();
        this.initVerificationKeys();
    }

    public async messageSending(message: any,
                                destinations: Destination | Destination[],
                                options: MessageOptions,
                                ctx: HandlerContext): Promise<any> {
        const dests = Array.isArray(destinations) ? destinations : [destinations];

        if (dests.some(d => d.userAgent === "ingester" && (d as CustomEventDestination).rootType === "SdmGoal")) {

            const goal = signGoal(message as SdmGoalMessage & SignatureMixin, this.gsc);
            logger.info(`Signed outgoing goal '${goal.uniqueName}' of '${goal.goalSetId}'`);
            return goal;
        }

        return message;
    }

    private initVerificationKeys(): void {
        if (!Array.isArray(this.gsc.verificationKeys)) {
            if (!!this.gsc.verificationKeys) {
                this.gsc.verificationKeys = [this.gsc.verificationKeys];
            } else {
                this.gsc.verificationKeys = [];
            }
        }

        // If signing key is set, also use it to verify
        if (!!this.gsc.signingKey) {
            this.gsc.verificationKeys.push(this.gsc.signingKey);
        }

        // Load the Atomist public key
        const publicKey = fs.readFileSync(path.join(__dirname, "atomist-public.pem")).toString();
        this.gsc.verificationKeys.push({ publicKey, name: "atomist.com/sdm" });
    }
}

/**
 * Verify a goal signature against the public keys configured in provided Configuration.
 * If signature can't be verified, the goal will be marked as failed and an Error will be thrown.
 * @param goal goal to verify
 * @param gsc signing configuration
 * @param ctx
 */
export async function verifyGoal(goal: SdmGoalEvent & DeepPartial<SignatureMixin>,
                                 gsc: GoalSigningConfiguration,
                                 ctx: HandlerContext): Promise<void> {
    if (!!gsc && gsc.enabled === true && !!goal && !isGoalRejected(goal)) {
        if (!!goal.signature) {

            const signature = Buffer.from(goal.signature, "base64");
            const message = normalizeGoal(goal);
            const verifiedWith = (gsc.verificationKeys as GoalVerificationKey[]).find(vk => {
                const verifier = crypto.createVerify("RSA-SHA512");
                verifier.update(message);
                verifier.end();
                return verifier.verify(vk.publicKey, signature);
            });

            if (!!verifiedWith) {
                logger.info(
                    `Verified signature for incoming goal '${goal.uniqueName}' of '${goal.goalSetId}' with key '${verifiedWith.name}'`);
            } else {
                await rejectGoal("signature was invalid", goal, ctx);
                throw new Error("SDM goal signature invalid. Rejecting goal!");
            }
        } else {
            await rejectGoal("signature was missing", goal, ctx);
            throw new Error("SDM goal signature is missing. Rejecting goal!");
        }
    }
}

/**
 * Add a signature to a goal
 * @param goal
 * @param gsc
 */
export function signGoal(goal: SdmGoalMessage,
                         gsc: GoalSigningConfiguration): SdmGoalMessage  & SignatureMixin {
    if (!!gsc && gsc.enabled === true && !!gsc.signingKey) {
        const signer = crypto.createSign("RSA-SHA512");
        signer.update(normalizeGoal(goal));
        signer.end();

        const signature = signer.sign({
            key: gsc.signingKey.privateKey,
            passphrase: gsc.signingKey.passphrase,
        });

        (goal as any).signature = signature.toString("base64");

        return goal as any;
    }
}

async function rejectGoal(reason: string,
                          sdmGoal: SdmGoalEvent,
                          ctx: HandlerContext): Promise<void> {
    await updateGoal(
        ctx,
        sdmGoal,
        {
            state: SdmGoalState.failure,
            description: `Rejected ${sdmGoal.name} because ${reason}`,
        });
}

function isGoalRejected(sdmGoal: SdmGoalEvent): boolean {
    return sdmGoal.state === SdmGoalState.failure && sdmGoal.description === `Rejected: ${sdmGoal.name}`;
}

export function normalizeGoal(goal: SdmGoalMessage | SdmGoalEvent): string {
    return `uniqueName:${goal.uniqueName}
        environment:${goal.environment}
        goalSetId:${goal.goalSetId}
        state:${goal.state}
        ts:${goal.ts}
        version:${goal.version}
        repo:${goal.repo.owner}/${goal.repo.name}/${goal.repo.providerId}
        sha:${goal.sha}
        branch:${goal.branch}
        fulfillment:${goal.fulfillment.name}-${goal.fulfillment.method}
        preConditions:${(goal.preConditions || []).map(p => `${p.environment}/${p.uniqueName}`)}
        data:${normalizeValue(goal.data)}
        url:${normalizeValue(goal.url)}
        externalUrls:${(goal.externalUrls || []).map(u => u.url).join(",")}
        provenance:${(goal.provenance || []).map(normalizeProvenance).join(",")}
        retry:${normalizeValue(goal.retryFeasible)}
        approvalRequired:${normalizeValue(goal.approvalRequired)}
        approval:${normalizeProvenance(goal.approval)}
        preApprovalRequired:${normalizeValue(goal.preApprovalRequired)}
        preApproval:${normalizeProvenance(goal.preApproval)}`;
}

function normalizeProvenance(p: SdmProvenance): string {
    if (!!p) {
        return `${normalizeValue(p.registration)}:${normalizeValue(p.version)}/${normalizeValue(p.name)}-${
            normalizeValue(p.userId)}-${normalizeValue(p.channelId)}-${p.ts}`;
    } else {
        return "undefined";
    }
}

function normalizeValue(value: any): string {
    if (!!value) {
        return value.toString();
    } else {
        return "undefined";
    }
}