// src/create/catalog/index.js
//
// The catalogue: every kind of project Continuum can create, its variants,
// their options and detail fields, and the dependencies each can add. Plain
// data (plus each variant's template), owned by the server; the wizard is
// drawn entirely from catalogJson(). Adding a variant or a dependency is an
// entry here, nothing in the UI.

import { FIELD_RULES } from "../fields.js";
import react from "./react.js";
import node from "./node.js";
import vue from "./vue.js";
import angular from "./angular.js";
import svelte from "./svelte.js";
import staticSite from "./static.js";
import python from "./python.js";
import go from "./go.js";
import dotnet from "./dotnet.js";
import spring, { refreshSpring } from "./spring.js";
import java from "./java.js";

export const KINDS = [react, vue, angular, svelte, node, python, spring, java, go, dotnet, staticSite];

/** Brings live parts of the catalogue up to date (Spring Initializr's metadata) */
export const refreshCatalog = () => refreshSpring();

export const findKind = (id) => KINDS.find((k) => k.id === id) ?? null;
export const findVariant = (kind, id) => kind?.variants.find((v) => v.id === id) ?? null;

/** The dependencies a variant offers (a dependency names the variants it fits, or "*" for all of its kind). */
export function dependenciesFor(kind, variant) {
  return (kind.dependencies ?? []).filter((d) => !d.appliesTo || d.appliesTo === "*" || d.appliesTo.includes(variant.id));
}

/** The catalogue as the wizard sees it: no templates or code, only data. */
export function catalogJson() {
  return {
    rules: FIELD_RULES,
    kinds: KINDS.filter((k) => k.variants.length).map((k) => ({
      id: k.id,
      name: k.name,
      icon: k.icon,
      description: k.description,
      groups: k.groups ?? [],
      variants: k.variants.map((v) => ({
        id: v.id,
        name: v.name,
        icon: v.icon,
        description: v.description,
        options: v.options ?? [],
        details: v.details,
      })),
      dependencies: (k.dependencies ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        group: d.group,
        icon: d.icon ?? null,
        docs: d.docs ?? null,
        appliesTo: d.appliesTo ?? "*",
        requires: d.requires ?? [],
        conflicts: d.conflicts ?? [],
        when: d.when ?? null,
        versionRange: d.versionRange ?? null,
      })),
    })),
  };
}
