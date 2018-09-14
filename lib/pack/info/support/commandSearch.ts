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
    HandleCommand,
    isCommandHandlerMetadata,
    Maker,
    toFactory,
} from "@atomist/automation-client";
import { CommandHandlerMetadata } from "@atomist/automation-client/lib/metadata/automationMetadata";
import { FunctionalUnit } from "@atomist/sdm";

export interface HandlerInfo {
    maker: Maker<HandleCommand<any>>;
    instance: HandleCommand<any> & CommandHandlerMetadata;
}

/**
 * Return command handlers with a given tag.
 * Note this may not find all, but it will find those that know their
 * own metadata, which is true of all those returned by generatorCommand
 * and the underlying commandHandlerFrom
 * @param {FunctionalUnit} unit
 * @param {string} tag
 */
export function commandHandlersWithTag(unit: FunctionalUnit, tag: string): HandlerInfo[] {
    return selfDescribingHandlers(unit)
        .filter(hi => hi.instance.tags.some(t => t.name === tag));
}

/**
 * Return command handlers along with their metadata
 * Note this may not find all, but it will find those that know their
 * own metadata
 * @param {FunctionalUnit} unit
 */
export function selfDescribingHandlers(unit: FunctionalUnit): HandlerInfo[] {
    return unit.commandHandlers
        .map(maker => ({maker, instance: toFactory(maker)()}))
        .filter(hi => isCommandHandlerMetadata(hi.instance)) as HandlerInfo[];
}
