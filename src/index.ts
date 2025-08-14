/*
 * @file Contains all the main code to manage intelli widgets in a website
 * @author Seppe De Langhe <seppe.delanghe@intelliprove.com>
 * @version 1.0.4-dev
 */

/*
 * Polyfill for 'replaceAll' support on older browsers
 */

// @ts-ignore
if (!String.prototype.replaceAll) {
  // @ts-ignore
  String.prototype.replaceAll = function (search: string | RegExp, replace: string): string {
    if (typeof search === "string") {
      return this.split(search).join(replace);
    } else if (search instanceof RegExp) {
      // If search is a regular expression, use the `replace` method in a loop
      return this.replace(new RegExp(search, "g"), replace);
    }
    throw new TypeError("The search argument must be a string or a RegExp");
  };
}

/*
 * Error classes
 */

export class IntelliAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliAuthError";
  }
}

export class IntelliActionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliActionTokenError";
  }
}

export class IntelliWidgetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliWidgetNotFoundError";
  }
}

export class IntelliInvalidParamaterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliInvalidParamaterError";
  }
}

export class IntelliUnexpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliUnexpectedError";
  }
}

export class IntelliSdkLoadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelliSdkLoadingError";
  }
}

export interface WidgetConfig {
  appearance: {
    theme: object;
    language: string | null;
    variation: string;
  };
  data: object;
}

export class IntelliWidgetConfig {
  name: string;
  config: object;
  variation: string;
  themeOverrides: object;
  baseURL: string;
  auth: string;
  version: number;

  constructor(name: string, config: object, variation: string, themeOverrides: object, baseURL: string, auth: string, version: number) {
    this.name = name;
    this.config = config;
    this.variation = variation;
    this.themeOverrides = themeOverrides;
    this.baseURL = baseURL;
    this.auth = auth;
    this.version = version;
  }
}

export class IntelliWidget {
  widgetId: string;
  widgetConfig: IntelliWidgetConfig;
  innerContent: Element | null;
  instances: string[];
  headElements: HTMLElement[];
  bodyScripts: HTMLScriptElement[];
  headInjected: boolean = false;

  constructor(widgetId: string, widgetConfig: IntelliWidgetConfig) {
    this.widgetId = widgetId;
    this.widgetConfig = widgetConfig;

    this.innerContent = null;
    this.instances = [];
    this.headElements = [];
    this.bodyScripts = [];

    this.eventHandler = this.eventHandler.bind(this);
    window.addEventListener("message", this.eventHandler);
  }

  fetched(): boolean {
    return this.innerContent !== null;
  }

  async fetch(locale: string | null = null): Promise<void> {
    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");
    myHeaders.append("Authorization", `Token ${this.widgetConfig.auth}`);

    const body: WidgetConfig = {
      appearance: {
        theme: this.widgetConfig.themeOverrides,
        language: locale,
        variation: this.widgetConfig.variation,
      },
      data: this.widgetConfig.config,
    };

    const requestOptions: RequestInit = {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify(body),
      redirect: "follow",
    };

    const url = `${this.widgetConfig.baseURL}/widgets/${this.widgetConfig.name}?version=${this.widgetConfig.version}`;
    const response = await fetch(url, requestOptions);

    switch (response.status) {
      case 400:
        try {
          const body = await response.json();
          if ("detail" in body && body["detail"]) {
            throw new IntelliWidgetNotFoundError(body["detail"]);
          }
          throw new IntelliActionTokenError("Your authentication is valid but it does not contain a link to a user.");
        } catch (e) {
          console.error(e);
          throw new IntelliSdkLoadingError("Unexpected error, got status code 400 from API without a valid response body");
        }
      case 401:
        throw new IntelliActionTokenError("Your authentication is invalid. Please double check and/or refresh your authentication.");
      case 404:
        const notFoundError = await response.json();
        throw new IntelliWidgetNotFoundError(notFoundError["detail"]);
      case 422:
        const validationError = await response.json();
        throw new IntelliInvalidParamaterError(`'${validationError["detail"][0]["loc"]}': ${validationError[0]["msg"]}`);
      case 500:
        console.error(await response.text());
        throw new IntelliUnexpectedError(
          "An unexpected server error occurred, cannot load widget. If this issue persists, please contact our support team."
        );
    }

    const result = await response.text();
    const container = document.createElement("div");
    container.innerHTML = result;

    const scripts: NodeListOf<HTMLScriptElement> = container.querySelectorAll("script");
    const styles: NodeListOf<HTMLStyleElement> = container.querySelectorAll("style");
    const links: NodeListOf<HTMLLinkElement> = container.querySelectorAll("link");

    this.headElements = [];
    this.headElements.push(...Array.from(scripts).filter((s) => !!s.src));
    this.headElements.push(...Array.from(styles));
    this.headElements.push(...Array.from(links));

    this.bodyScripts = Array.from(scripts).filter((s) => !s.src);
    this.innerContent = container.querySelector(".intelli-widget");
  }

  mount(selector: string): void {
    const targetElem = document.querySelector<HTMLElement>(selector);
    if (!targetElem) {
      throw new Error(`No element found for selector '${selector}'!`);
    }

    if (!IntelliProveWidgets.loaded()) {
      throw new Error("IntelliProve widgets not loaded!");
    }

    // unique id for widget + instance
    const uid = this.widgetId + "-" + this.instances.length.toString();

    for (let headElement of this.headElements) {
      IntelliProveWidgets.injectHeadElement(headElement, uid);
    }

    if (!this.instances.includes(selector)) {
      this.instances.push(selector);
    }
    if (this.innerContent instanceof HTMLElement) {
      const innerHTML = this.innerContent.outerHTML.replaceAll("intelli-widget-id", uid);
      targetElem.innerHTML = innerHTML;
    }

    for (let script of this.bodyScripts) {
      IntelliProveWidgets.injectBodyScript(script, uid);
    }
  }

  updateAll(): void {
    const instancesState = JSON.parse(JSON.stringify(this.instances));
    this.instances = [];
    for (let i = 0; i < instancesState.length; i++) {
      try {
        this.mount(instancesState[i]);
      } catch (e) {
        console.warn("Error while re-mounting existing widget: " + e);
      }
    }
  }

  removeAll(): void {
    for (let selector of this.instances) {
      try {
        const targetElem = document.querySelector(selector);
        if (targetElem) {
          targetElem.innerHTML = "";
        } else {
          throw new Error(`No element found for selector '${selector}'!`);
        }
      } catch (e) {
        console.warn("Error while removing existing widget: " + e);
      }
    }
    this.instances = [];
  }

  async eventHandler(event: MessageEvent): Promise<void> {
    const data = event.data;
    if (typeof data !== "object" || !("target" in data)) {
      return;
    }

    if (data["target"] !== "intelli-widgets") {
      return;
    }

    const messageKind = data["kind"];
    switch (messageKind) {
      case "language":
        const locale = data["data"];
        await this.fetch(locale);
        this.updateAll();
        break;
      case "clear":
        this.removeAll();
        break;
      default:
        console.warn("Invalid intelli-widgets message" + event);
        break;
    }
  }
}

export class IntelliProveWidgets {
  url: string;
  action_token: string;
  api_version: string;
  modulesLoadStart: number;
  cdnUrl: string;
  locale: string | null;
  defaultWidgetVersion: number = 2;

  private _loadingWidgetPromises: { [name: string]: Promise<string> };
  private _errorWidgetPromises: { [name: string]: Promise<string> };
  static styleIdentifier: string = IntelliProveWidgets.newId("intelliprove-styling-");

  constructor(action_token: string, url: string = "https://engine.intelliprove.com", locale: string | null = null, version: string = "v2") {
    this.url = (url.charAt(url.length - 1) === "/" ? url : url + "/") + version;
    this.action_token = action_token;
    this.api_version = version;
    this.modulesLoadStart = Date.now();
    this.cdnUrl = "https://cdn.intelliprove.com";
    this.locale = locale;

    IntelliProveWidgets.load(this.cdnUrl);
    IntelliProveWidgets.createStyleElement();
    this._loadingWidgetPromises = {};
    this._errorWidgetPromises = {};
  }

  static newId(prefix: string = "intelli-widget-", length: number = 8): string {
    let id = prefix;
    const chars = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < length; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  static chartJSLoaded(): boolean {
    return typeof (window as any).Chart !== "undefined";
  }

  static chartJSPluginsLoaded(): boolean {
    return typeof (window as any).ChartDataLabels !== "undefined";
  }

  static loaded(): boolean {
    return IntelliProveWidgets.chartJSLoaded() && IntelliProveWidgets.chartJSPluginsLoaded();
  }

  static createStyleElement() {
    const styleElement = document.createElement("style");
    styleElement.id = IntelliProveWidgets.styleIdentifier;
    document.head.appendChild(styleElement);
  }

  static appendStyling(css: string) {
    const styleElement = document.getElementById(IntelliProveWidgets.styleIdentifier);
    if (!styleElement) {
      IntelliProveWidgets.createStyleElement();
    }

    styleElement!.innerText += css;
  }

  static newStylingSheet(css: string) {
    const newStyle = document.createElement("style");
    newStyle.textContent = css; // use textContent for slightly better perf
    document.head.appendChild(newStyle);
  }

  static injectHeadScript(script: HTMLScriptElement): void {
    const newScript = document.createElement("script");
    newScript.type = "text/javascript";
    newScript.src = script.src;
    document.head.appendChild(newScript);
  }

  static injectHeadLink(linkElement: HTMLLinkElement): void {
    document.head.appendChild(linkElement);
  }

  static injectHeadStyle(styleElement: HTMLStyleElement): void {
    IntelliProveWidgets.newStylingSheet(styleElement.innerText);
  }

  static injectHeadElement(element: HTMLElement, replaceId: string | null = null): void {
    if (replaceId) {
      element.innerText = element.innerText.replaceAll("intelli-widget-id", replaceId);
    }
    switch (element.nodeName) {
      case "SCRIPT":
        IntelliProveWidgets.injectHeadScript(element as HTMLScriptElement);
        break;
      case "STYLE":
        IntelliProveWidgets.injectHeadStyle(element as HTMLStyleElement);
        break;
      case "LINK":
        IntelliProveWidgets.injectHeadLink(element as HTMLLinkElement);
        break;
      default:
        throw new Error("Invalid element type! Element must be one of: script, link, style");
    }
  }

  static injectBodyScript(script: HTMLScriptElement, replaceId: string | null = null): void {
    const newScript = document.createElement("script");
    newScript.type = "text/javascript";
    let textContent = script.textContent || "";
    if (replaceId !== null) {
      textContent = textContent.replaceAll("intelli-widget-id", replaceId);
    }

    newScript.textContent = textContent;
    document.body.appendChild(newScript);
    window.setTimeout(() => {
      newScript.remove();
    }, 500);
  }

  static injectScript(uri: string, conditionCheck?: () => boolean, scriptType: "module" | "default" = "module"): void {
    if (conditionCheck && !conditionCheck()) {
      window.requestAnimationFrame(() => {
        IntelliProveWidgets.injectScript(uri, conditionCheck, scriptType);
      });
      return;
    }
    const scriptTag = document.createElement("script");
    if (scriptType === "module") {
      scriptTag.type = "module";
    }
    scriptTag.src = uri;
    scriptTag.crossOrigin = "anonymous";
    document.head.appendChild(scriptTag);
  }

  static load(cdnUrl: string): void {
    IntelliProveWidgets.injectScript(`${cdnUrl}/third-party/v1/chartjs.js`, undefined, "default");
    IntelliProveWidgets.injectScript(`${cdnUrl}/third-party/v1/chartjs-plugin-datalabels.js`, IntelliProveWidgets.chartJSLoaded, "default");
    IntelliProveWidgets.injectScript(`${cdnUrl}/third-party/v1/d3.js`, undefined, "default");
    IntelliProveWidgets.injectScript(`${cdnUrl}/third-party/v1/swiper-bundle.min.js`, undefined, "default");
  }

  loadTimeExceeded(): boolean {
    return this.modulesLoadStart + 10_000 < Date.now();
  }

  changeLanguage(locale: string): void {
    this.locale = locale;
    window.postMessage({ target: "intelli-widgets", kind: "language", data: this.locale });
  }

  setDefaultWidgetVersion(version: number): void {
    this.defaultWidgetVersion = version;
  }

  async fetchLoadingWidget(name: string, retries: number = 0): Promise<string> {
    if (retries >= 2) return "Loading...";

    let uri = `${this.cdnUrl}/content/v1/loading-states/${name}.html`;
    const requestOptions: RequestInit = {
      method: "GET",
      redirect: "follow",
    };

    try {
      const response = await fetch(uri, requestOptions);
      if (response.status !== 200) {
        return await this.fetchLoadingWidget(name, retries + 1);
      }
      return await response.text();
    } catch {
      return "Loading...";
    }
  }

  async fetchLoadingFixedWidget(retries: number = 0): Promise<string> {
    if (retries >= 2) return "Loading...";

    let uri = `${this.cdnUrl}/content/v1/widget-loading.html`;
    const requestOptions: RequestInit = {
      method: "GET",
      redirect: "follow",
    };

    const response = await fetch(uri, requestOptions);
    if (response.status === 404) return "Loading...";
    if (response.status !== 200) return await this.fetchLoadingFixedWidget(retries + 1);
    return await response.text();
  }

  async fetchErrorWidget(name: string, retries: number = 0): Promise<string> {
    const fallback = '<p style="color: red;">Failed to get widget</p>';
    if (retries >= 2) return fallback;

    const uri = `${this.cdnUrl}/content/v1/error-states/${name}.html`;
    const requestOptions: RequestInit = {
      method: "GET",
      redirect: "follow",
    };

    const response = await fetch(uri, requestOptions);
    if (response.status === 404) return fallback;
    if (response.status !== 200) return await this.fetchErrorWidget(name, retries + 1);
    return await response.text();
  }

  async getLoadingWidget(name: string, version: number | null = null): Promise<string> {
    version = version === null ? this.defaultWidgetVersion : version;
    if (version === 1) {
      name = "fixed";
    }

    if (Object.keys(this._loadingWidgetPromises).includes(name)) {
      return await this._loadingWidgetPromises[name];
    }

    this._loadingWidgetPromises[name] = version === 1 ? this.fetchLoadingFixedWidget() : this.fetchLoadingWidget(name);
    return this.getLoadingWidget(name, version);
  }

  async getErrorWidget(name: string): Promise<string> {
    if (Object.keys(this._errorWidgetPromises).includes(name)) {
      return await this._errorWidgetPromises[name];
    }

    this._errorWidgetPromises[name] = this.fetchErrorWidget(name);
    return this.getErrorWidget(name);
  }

  async getWidget(
    name: string,
    config: object,
    variation: string = "default",
    themeOverrides: object = {},
    version: number | null = null
  ): Promise<IntelliWidget> {
    const widgetConfig = new IntelliWidgetConfig(
      name,
      config,
      variation,
      themeOverrides,
      this.url,
      this.action_token,
      version || this.defaultWidgetVersion
    );
    while (!IntelliProveWidgets.loaded()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.loadTimeExceeded()) {
        throw new IntelliSdkLoadingError(
          "Failed to load required JS modules for our widgets, please reload the page. If this issue persists, please contact our support team."
        );
      }
    }

    let widget = new IntelliWidget(IntelliProveWidgets.newId(), widgetConfig);
    await widget.fetch(this.locale);

    return widget;
  }

  async mountWidget(
    selector: string,
    name: string,
    config: object,
    variation: string = "default",
    themeOverrides: object = {},
    version: number | null = null
  ): Promise<IntelliWidget> {
    const loadingName = name === "biomarker" && variation === "small" ? "biomarker-xs" : name;
    const loadingWidget = await this.getLoadingWidget(loadingName, version);
    const widgetPromise = this.getWidget(name, config, variation, themeOverrides, version);

    const elem = document.querySelector<HTMLElement>(selector);
    if (elem) {
      elem.innerHTML = loadingWidget;
    }

    try {
      const widget = await widgetPromise;
      widget.mount(selector);
      return widget;
    } catch (e) {
      const errorWidget = await this.getErrorWidget(loadingName);
      if (elem) elem.innerHTML = errorWidget;
      throw e; // re-throw after setting error state
    }
  }

  clear(): void {
    window.postMessage({ target: "intelli-widgets", kind: "clear" });
  }
}
