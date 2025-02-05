/*
 * Copyright (c) 2021 NAVER Corp.
 * egjs projects are licensed under the MIT license
 */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable arrow-body-style */
import DocumentedClass from "./types/DocumentedClass";
import DocumentParams from "./types/DocumentParams";
import Identifier from "./types/Identifier";

export const isStatic = (data: Identifier) => data.scope && data.scope === "static";
export const isReadonly = (data: Identifier) => !!data.readonly;
export const isPrivate = (data: Identifier) => data.access && data.access === "private";
export const isInternal = (data: Identifier) => data.customTags && data.customTags.some(val => val.tag === "internal");
export const isInherited = (data: Identifier) => !!data.inherited && data.inherits;
export const isAsync = (data: Identifier) => !!data.async;

export const getDescription = (data: { description?: string;[key: string]: any }, { locale }: DocumentParams) => {
  const description = data.description
    ? data[locale]
      ? data[locale] as string
      : data.description
    : "";

  return description.replace(/\n/g, "<br />");
}

export const parseTypescriptName = (name: string) => {
  const matched = /^\$ts:(.+)(?:<file>(?:.+)<\/file>)$/.exec(name);

  if (!matched) return name;

  return matched[1] ?? name;
};
export const parseType = (type: Identifier["type"], { dataMap }: DocumentParams, encodeHtml: boolean = true) => {
  // e.g. { [key in Key]: number } but actually: [key extends Key]: number
  const keysInStringsObjectRegex = /^\[(?:[^:]+) extends ([^\]]+)\]:(.+)$/
  const functionRegex = /^\(((?:.+):(?:.+))\) *=> *(.+)$/;
  const genericRegex = /^(?:(\S+?)<)(.+)+(?:>)$/;
  const arrayRegex = /^(.+)\[\]$/;
  const objectRegex = /^{(.+)}$/;
  const separatorRegex = /[|&,]/;

  // e.g. { [key: string]: number }
  const dynamicObjectRegex = /^\[(?:[^:]+):(?:[^\]]+)\]:(.+)$/;

  if (!type) return "";

  const parsedType = type.names
    .map(name => parseTypescriptName(name))
    .map(name => {
      const checkingValues: string[] = [];

      function pushTypes(typeName: string) {
        console.log("typeName", typeName);
        if (keysInStringsObjectRegex.test(typeName)) {
          const matched = keysInStringsObjectRegex.exec(typeName)!;
          pushTypes(matched[1].trim());
          pushTypes(matched[2].trim());
        } else if (functionRegex.test(typeName)) {
          pushFunctionMatches(typeName);
        } else if (arrayRegex.test(typeName)) {
          pushArrayMatches(typeName);
        } else if (objectRegex.test(typeName)) {
          pushObjectMatches(typeName);
        } else if (genericRegex.test(typeName)) {
          pushGenericMatches(typeName);
        } else if (separatorRegex.test(typeName)) {
          typeName
            .replace(/<(.+)>|\((.+)\)|{(.+)}/g, ($0) => { console.log("$0", $0); return `${$0.replace(new RegExp(separatorRegex, "g"), "%separator%")}` }) // カッコ内の"区切り"では区切らないようにする
            .replace(/[\(\)]/g, "")
            .split(separatorRegex)
            .map(val => val.trim())
            .forEach(val => pushTypes(val.replace(/%separator%/g, ","))); // %separator%を区切れ目だとわかれば何でも良いので | & , のいずれかにする (オブジェクトを崩さないことを考えると ,　がベスト)
        } else {
          checkingValues.push(typeName);
        }
      }

      function pushGenericMatches(typeName: string) {
        const genericMatches = genericRegex.exec(typeName);
        checkingValues.push(genericMatches![1]);
        pushTypes(genericMatches![2]);
      }

      function pushArrayMatches(typeName: string) {
        const arrayMatches = arrayRegex.exec(typeName);
        pushTypes(arrayMatches![1]);
      }

      function pushObjectMatches(typeName: string) {
        const objectMatches = objectRegex.exec(typeName);
        const matched = objectMatches![1];
        if (dynamicObjectRegex.test(matched)) {
          pushTypes(dynamicObjectRegex.exec(matched)![1].trim());
        } else {
          const valueTypes = matched.split(/,|;/).map(e => e.split(":")[1]).map(e => e?.trim()).filter(e => e);
          valueTypes.forEach(t => pushTypes(t));
        }
      }

      function pushFunctionMatches(typeName: string) {
        const functionMatches = functionRegex.exec(typeName);
        const params = functionMatches![1];
        const returns = functionMatches![2];

        const valueTypes = params.split(",").map(e => e.split(":")[1]).map(e => e?.trim()).filter(e => e);
        valueTypes.forEach(t => pushTypes(t));

        pushTypes(returns);
      }

      pushTypes(name);

      const checked: { [key: string]: boolean } = {};

      checkingValues.forEach(val => {
        if (dataMap.has(val) && !checked[val]) {
          checked[val] = true;
          name = name.replace(val, `[${val}](${val.replace(/event:/g, "event-").replace(/\./g, ":")})`);
        }
      });

      return name;
    })
    .join(" | ")
    .replace(/\|/g, "\\|")
    .replace(/Array\./g, "Array");

  return encodeHtml ? parsedType.replace(/</g, "&lt;").replace(/>/g, "&gt;") : parsedType;
};
export const parseName = (name: string) => {
  const parsed = /(?:\S):(?:\S)[.|#](\S)+/.exec(name);
  return parsed ? (parsed.groups![0] ?? name) : name;
};
export const parseURL = (url: string) => {
  return url;
};
export const parseLink = (text?: string) => {
  // Code from dmd/ddata (https://github.com/jsdoc2md/dmd/blob/master/helpers/ddata.js#L616)
  if (!text) return [];

  const results: Array<{
    original: string;
    caption: string;
    url: string;
  }> = [];
  let matches: RegExpExecArray | null = null;
  const link1 = /{@link\s+([^\s}|]+?)\s*}/g; // {@link someSymbol}
  const link2 = /\[([^\]]+?)\]{@link\s+([^\s}|]+?)\s*}/g; // [caption here]{@link someSymbol}
  const link3 = /{@link\s+([^\s}|]+?)\s*\|([^}]+?)}/g; // {@link someSymbol|caption here}
  const link4 = /{@link\s+([^\s}|]+?)\s+([^}|]+?)}/g; // {@link someSymbol Caption Here}

  while ((matches = link4.exec(text)) !== null) {
    results.push({
      original: matches[0],
      caption: matches[2],
      url: matches[1]
    });
    text = text.replace(matches[0], " ".repeat(matches[0].length));
  }

  while ((matches = link3.exec(text)) !== null) {
    results.push({
      original: matches[0],
      caption: matches[2],
      url: matches[1]
    });
    text = text.replace(matches[0], " ".repeat(matches[0].length));
  }

  while ((matches = link2.exec(text)) !== null) {
    results.push({
      original: matches[0],
      caption: matches[1],
      url: matches[2]
    });
    text = text.replace(matches[0], " ".repeat(matches[0].length));
  }

  while ((matches = link1.exec(text)) !== null) {
    results.push({
      original: matches[0],
      caption: matches[1],
      url: matches[1]
    });
    text = text.replace(matches[0], " ".repeat(matches[0].length));
  }

  results.map(result => {
    if (!result.url.startsWith("http")) {
      result.url = result.url.replace(/event:/g, "event-").replace(/\./g, "#");
    }
    return result;
  });

  return results;
};
export const inlineLink = (text?: string) => {
  if (!text) return "";

  const results = parseLink(text);

  results.forEach(result => {
    text = text!.replace(result.original, `[${result.caption}](${result.url})`);
  });

  return text;
};

// Add locales to object if the object description has locales in it
export const parseLocales = (obj: { description: string }, locale: string) => {
  const localeRegex = new RegExp(`<${locale}>(.+)<\/${locale}>`, "s");
  const result = localeRegex.exec(obj.description);

  if (result) {
    obj.description = obj.description.replace(localeRegex, "").trim();
    obj[locale] = result[1];
  }
};

export const hashLink = (name: string, id: string) => `<a href="#${id}">${name}</a>`;

export const showExtends = (classData: DocumentedClass) => classData.augments && classData.augments.length > 0
  ? ` extends ${classData.augments.map(name => parseTypescriptName(name)).join(", ")}`
  : "";
export const showImplements = (data: Identifier) => data.implements && data.implements.length > 0
  ? ` implements ${data.implements.map(name => parseTypescriptName(name)).join(", ")}`
  : "";

export const showTags = (data: Identifier, docParams: DocumentParams) => `<div${docParams.config.bulma ? ` className="bulma-tags"` : ""}>
${[
    isStatic(data) ? `<span className="${docParams.config.bulma ? "bulma-tag is-info" : "badge badge--info"}">static</span>` : null,
    isPrivate(data) ? `<span className="${docParams.config.bulma ? "bulma-tag is-primary" : "badge badge--primary"}">private</span>` : null,
    isReadonly(data) ? `<span className="${docParams.config.bulma ? "bulma-tag is-warning" : "badge badge--warning"}">readonly</span>` : null,
    isInherited(data) ? `<span className="${docParams.config.bulma ? "bulma-tag is-danger" : "badge badge--danger"}">inherited</span>` : null,
    isAsync(data) ? `<span className="${docParams.config.bulma ? "bulma-tag is-success" : "badge badge--success"}">async</span>` : null,
  ].filter(val => !!val).map(val => `  ${val}`).join("\n")}
</div>`;

export const showType = (type: Identifier["type"], docParams: DocumentParams) => type
  ? `**Type**: ${parseType(type, docParams)}`
  : "";

export const showDefault = (defaultVal: Identifier["defaultvalue"], docParams: DocumentParams) => defaultVal
  ? `**Default**: ${parseType({ names: [defaultVal] }, docParams)}`
  : "";

export const showReturn = (returns: Identifier["returns"], docParams: DocumentParams) => returns && returns.length > 0
  ? `**Returns**: ${returns.filter(val => !!val.type).map(({ type }) => parseType(type!, docParams))}
${returns.map(val => val.description ? `- ${inlineLink(getDescription(val, docParams))}` : "").join("\n")}`
  : "";

export const showEmit = (emits: Identifier["fires"], docParams: DocumentParams) => emits && emits.length > 0
  ? `**Emits**: ${emits.map(emit => parseType({ names: [emit] }, docParams)).join(", ")}`
  : "";

export const showParameters = (params: Identifier["params"], docParams: DocumentParams) => params && params.length > 0
  ? `|PARAMETER|TYPE|OPTIONAL|DEFAULT|DESCRIPTION|
|:---:|:---:|:---:|:---:|:---:|
${params.map(param => `|${param.name}|${parseType(param.type, docParams)}|${param.optional ? "✔️" : ""}|${inlineLink(param.defaultvalue?.toString())}|${inlineLink(getDescription(param, docParams))}|`).join("\n")}`
  : "";

export const showProperties = (properties: Identifier["properties"], docParams: DocumentParams) => {
  if (!properties || properties.length === 0) {
    return "";
  }
  const hasDefault = properties.some(property => "defaultvalue" in property);
  const defaultTitle = hasDefault ? "DEFAULT|" : "";
  const defaultLine = hasDefault ? ":---:|" : "";

  return `|PROPERTY|TYPE|${defaultTitle}DESCRIPTION|
|:---:|:---:|${defaultLine}:---:|
${properties.map(param => {
    const defaultValue = hasDefault ? `${`${param.defaultvalue ?? ""}`.trim()}|` : "";

    return `|${param.name}|${parseType(param.type, docParams)}|${defaultValue}${inlineLink(getDescription(param, docParams))}|`;
  }).join("\n")}`;
}

export const showThrows = (throws: Identifier["exceptions"], docParams: DocumentParams) => throws && throws.length > 0
  ? `${throws.map(exception => `**Throws**: ${parseType(exception.type, docParams)}\n\n${inlineLink(getDescription(exception, docParams))}`).join("\n")}`
  : "";

export const showSee = (see: Identifier["see"], docParams: DocumentParams) => see
  ? `**See**:
${see.map(val => parseType({ names: [getDescription(val, docParams)] }, docParams)).map(link => `- ${inlineLink(link)}`).join("\n")}`
  : "";

export const showExample = (data: Identifier) => data.examples
  ? data.examples.map(example => example.trim()).map(example => inlineLink(example)).join("\n\n")
  : "";

export const showInternalWarning = (data: Identifier) => isInternal(data) ? `<div className="notification is-warning my-2">⚠️ This ${data.kind} is for <strong>internal</strong> use only.</div>` : "";

export const showFunctionParams = (data: Identifier, docParams: DocumentParams) => {
  if (data.kind !== "function") return "";

  // Remove props inside objects
  const params = (data.params ?? []).filter(param => !param.name.includes("."))

  return `(${params.map(param => `${param.name}: ${parseType(param.type, docParams, false)}${param.defaultvalue ? ` = ${param.defaultvalue}` : ""}`).join(", ")})`
}
