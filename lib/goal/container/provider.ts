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

import { QueryNoCacheOptions } from "@atomist/automation-client";
import { isTokenCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import { SdmContext } from "@atomist/sdm";
import * as crypto from "crypto";
import {
    BinaryRepositoryProvider,
    BinaryRepositoryType,
    DockerRegistryProvider,
    Password,
} from "../../typings/types";
import {
    GoalContainer,
    GoalContainerEncryptedSecret,
    GoalContainerProviderSecret,
} from "./container";

interface Secrets {
    env: Array<{ name: string; value: string; }>;
    files: Array<{ mountPath: string; value: string; hostPath?: string; }>;
}

export async function prepareSecrets(container: Pick<GoalContainer, "secrets">,
                                     ctx: SdmContext): Promise<Secrets> {
    const secrets = {
        env: [],
        files: [],
    };
    if (container?.secrets?.env) {
        for (const secret of container.secrets.env) {
            if (!!(secret.value as any).provider) {
                const value = await prepareProviderSecret(secret.value as GoalContainerProviderSecret, ctx, secrets, secret.name);
                if (!!value) {
                    secrets.env.push({ name: secret.name, value });
                }
            } else if (!!(secret.value as any).encrypted) {
                const value = decryptSecret((secret.value as GoalContainerEncryptedSecret).encrypted, ctx);
                if (!!value) {
                    secrets.env.push({ name: secret.name, value });
                }
            }
        }
    }
    if (container?.secrets?.fileMounts) {
        for (const secret of container.secrets.fileMounts) {
            if (!!(secret.value as any).provider) {
                const value = await prepareProviderSecret(secret.value as GoalContainerProviderSecret, ctx, secrets);
                if (!!value) {
                    secrets.files.push({
                        value,
                        mountPath: secret.mountPath,
                    });
                }
            } else if (!!(secret.value as any).encrypted) {
                const value = decryptSecret((secret.value as GoalContainerEncryptedSecret).encrypted, ctx);
                if (!!value) {
                    secrets.files.push({
                        value,
                        mountPath: secret.mountPath,
                    });
                }
            }
        }
    }
    return secrets;
}

export async function prepareProviderSecret(secret: GoalContainerProviderSecret,
                                            ctx: SdmContext,
                                            secrets: Secrets,
                                            envName?: string): Promise<string> {
    if (secret?.provider) {
        switch (secret.provider.type) {
            case "docker":
                return prepareDockerProviderSecret(secret.provider.names || [], ctx, secrets, envName);
            case "scm":
                const creds = ctx.credentials;
                if (!creds) {
                    return undefined;
                } else if (isTokenCredentials(creds)) {
                    return creds.token;
                } else {
                    return JSON.stringify(creds);
                }
            case "npm":
                return prepareNpmProviderSecret(secret.provider.names || [], ctx, secrets, envName);
            case "maven2":
                return prepareMavenProviderSecret(secret.provider.names || [], ctx, secrets, envName);
            case "atomist":
                return ctx.configuration.apiKey;
            default:
                return undefined;
        }
    }
    return undefined;
}

export async function prepareDockerProviderSecret(names: string[],
                                                  ctx: SdmContext,
                                                  secrets: Secrets,
                                                  envName?: string): Promise<string> {
    const { context } = ctx;
    const dockerRegistries = await context.graphClient.query<DockerRegistryProvider.Query, DockerRegistryProvider.Variables>({
        name: "DockerRegistryProvider",
        options: QueryNoCacheOptions,
    });

    const dockerConfig = {
        auths: {},
    } as any;

    if (dockerRegistries?.DockerRegistryProvider) {
        const requestedDockerRegistries = dockerRegistries.DockerRegistryProvider
            .filter(d => names.length === 0 || names.includes(d.name));
        if (!!envName && requestedDockerRegistries.length > 1) {
            throw new Error("More then one matching Docker registry provider found for requested env variable");
        }

        for (const dockerRegistry of requestedDockerRegistries) {

            const credential = await context.graphClient.query<Password.Query, Password.Variables>({
                name: "Password",
                variables: {
                    id: dockerRegistry.credential.id,
                },
            });

            if (!envName) {
                dockerConfig.auths[dockerRegistry.url] = {
                    auth: Buffer.from(credential.Password[0].owner.login + ":" + credential.Password[0].secret).toString("base64"),
                };
            } else {
                secrets.env.push({ name: `${envName}_USER`, value: credential.Password[0].owner.login });
                return credential.Password[0].secret;
            }
        }
    }

    return JSON.stringify(dockerConfig);
}

export async function prepareMavenProviderSecret(names: string[],
                                                 ctx: SdmContext,
                                                 secrets: Secrets,
                                                 envName?: string): Promise<string> {
    if (!envName) {
        throw new Error("fileMounts are not supported for Maven2 repository provider secrets");
    }

    const { context } = ctx;
    const binaryRepositoryProviders = await context.graphClient.query<BinaryRepositoryProvider.Query, BinaryRepositoryProvider.Variables>({
        name: "BinaryRepositoryProvider",
        variables: {
            type: BinaryRepositoryType.maven2,
        },
        options: QueryNoCacheOptions,
    });

    if (binaryRepositoryProviders?.BinaryRepositoryProvider) {
        const requestedBinaryRepositoryProviders = binaryRepositoryProviders.BinaryRepositoryProvider
            .filter(d => names.length === 0 || names.includes(d.name));
        if (!!envName && requestedBinaryRepositoryProviders.length > 1) {
            throw new Error("More then one matching NPM repository provider found for requested env variable");
        }

        for (const binaryRepositoryProvider of requestedBinaryRepositoryProviders) {

            const credential = await context.graphClient.query<Password.Query, Password.Variables>({
                name: "Password",
                variables: {
                    id: binaryRepositoryProvider.credential.id,
                },
            });
            secrets.env.push({ name: `${envName}_USER`, value: credential.Password[0].owner.login });
            return credential.Password[0].secret;
        }
    }

    return undefined;
}

export async function prepareNpmProviderSecret(names: string[],
                                               ctx: SdmContext,
                                               secrets: Secrets,
                                               envName?: string): Promise<string> {

    const { context } = ctx;
    const binaryRepositoryProviders = await context.graphClient.query<BinaryRepositoryProvider.Query, BinaryRepositoryProvider.Variables>({
        name: "BinaryRepositoryProvider",
        variables: {
            type: BinaryRepositoryType.npm,
        },
        options: QueryNoCacheOptions,
    });

    const npmrc = [];

    if (binaryRepositoryProviders?.BinaryRepositoryProvider) {
        const requestedBinaryRepositoryProviders = binaryRepositoryProviders.BinaryRepositoryProvider
            .filter(d => names.length === 0 || names.includes(d.name));
        if (!!envName && requestedBinaryRepositoryProviders.length > 1) {
            throw new Error("More then one matching Maven2 repository provider found for requested env variable");
        }

        for (const binaryRepositoryProvider of requestedBinaryRepositoryProviders) {

            const credential = await context.graphClient.query<Password.Query, Password.Variables>({
                name: "Password",
                variables: {
                    id: binaryRepositoryProvider.credential.id,
                },
            });

            if (!envName) {
                const url = binaryRepositoryProvider.url.replace(/https?:\/\//, "");
                npmrc.push({ url, auth: credential.Password[0].secret });
            } else {
                secrets.env.push({ name: `${envName}_USER`, value: credential.Password[0].owner.login });
                return credential.Password[0].secret;
            }
        }
    }

    return npmrc.map(r => `//${r.url}/:_authToken=${r.auth}`).join("\n") + "\n";
}

function decryptSecret(secret: string, ctx: SdmContext): string {
    const { configuration } = ctx;
    const encryptionCfp = configuration.sdm.encryption;
    if (!encryptionCfp) {
        throw new Error("Encryption configuration missing to decrypt secret");
    }
    const decrypted = crypto.privateDecrypt({
        key: encryptionCfp.privateKey,
        passphrase: encryptionCfp.passphrase,
    }, Buffer.from(secret, "base64"));
    return decrypted.toString("utf8");
}
