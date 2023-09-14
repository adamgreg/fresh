import {
  type UnocssPluginContext,
  UnoGenerator,
  type UserConfig,
} from "https://esm.sh/@unocss/core@0.55.1";
import type { Theme } from "https://esm.sh/@unocss/preset-uno@0.55.1";
import MagicString from "https://esm.sh/v131/magic-string@0.30.0";
import { Plugin } from "$fresh/server.ts";
import { exists } from "$fresh/src/server/deps.ts";

// inline reset from https://esm.sh/@unocss/reset@0.54.2/tailwind.css
const unoResetCSS = `/* reset */
*,:before,:after{box-sizing:border-box;border:0 solid}html{-webkit-text-size-adjust:100%;-moz-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;line-height:1.5}body{line-height:inherit;margin:0}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-size:100%;font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,[type=button],[type=reset],[type=submit]{-webkit-appearance:button;background-color:#0000;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre{margin:0}fieldset{margin:0;padding:0}legend{padding:0}ol,ul,menu{margin:0;padding:0;list-style:none}textarea{resize:vertical}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}button,[role=button]{cursor:pointer}:disabled{cursor:default}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}
`;

type UnoCssPluginOptions = {
  runtime?: boolean;
  config?: UserConfig;
};

/** Applies UnoCSS transformers from the config to the given HTML string and returns the result */
async function applyTransformers(
  uno: InstanceType<typeof UnoGenerator>,
  html: string,
) {
  const { transformers } = uno.config;
  if (!transformers?.length) {
    return html;
  }

  const mutableHtml = new MagicString(html);

  // Sort transformers according to "enforce" property (if present)
  transformers.sort((a, b) => {
    const key = (x: typeof a) =>
      x.enforce === undefined ? 0 : (x.enforce === "pre" ? -1 : 1);
    return key(a) - key(b);
  });

  // Apply transformers and return the result
  for (const { transform } of transformers) {
    await transform(mutableHtml, "html", { uno } as UnocssPluginContext);
  }
  return mutableHtml.toString();
}

/**
 * Helper function for typing of config objects
 */
export function defineConfig<T extends object = Theme>(config: UserConfig<T>) {
  return config;
}

/**
 * UnoCSS plugin - automatically generates CSS utility classes
 *
 * @param [opts] Plugin options
 * @param [opts.runtime] By default the UnoCSS runtime will run in the browser. Set to `false` to disable this.
 * @param [opts.config] Explicit UnoCSS config object. By default `uno.config.ts` file. Not supported with the browser runtime.
 */
export default function unocss(
  opts: UnoCssPluginOptions = {},
): Plugin {
  // Include the browser runtime by default
  const runtime = opts.runtime ?? true;

  // A uno.config.ts file is required in the project directory if a config object is not provided,
  // or to use the browser runtime
  const configURL = new URL("./uno.config.ts", Deno.mainModule);

  let uno: UnoGenerator;
  if (opts.config !== undefined) {
    uno = new UnoGenerator(opts.config);
  } else {
    import(configURL.toString()).then((mod) => {
      uno = new UnoGenerator(mod.default);
    }).catch((error) => {
      exists(configURL, { isFile: true, isReadable: true }).then(
        (configFileExists) => {
          throw configFileExists ? error : new Error(
            "uno.config.ts not found in the project directory! Please create it or pass a config object to the UnoCSS plugin",
          );
        },
      );
    });
  }

  return {
    name: "unocss",
    entrypoints: runtime
      ? {
        "main": `
        data:application/javascript,
        import config from "${configURL}";
        import init from "https://esm.sh/@unocss/runtime@0.55.1";
        export default function() {
          window.__unocss = config;
          init();
        }`,
      }
      : {},
    async renderAsync(ctx) {
      const { htmlText } = await ctx.renderAsync();
      const transformedHtml = await applyTransformers(uno, htmlText);
      const { css } = await uno.generate(transformedHtml);

      return {
        scripts: runtime ? [{ entrypoint: "main", state: {} }] : [],
        styles: [{ cssText: `${unoResetCSS}\n${css}` }],
        htmlText: transformedHtml,
      };
    },
  };
}
