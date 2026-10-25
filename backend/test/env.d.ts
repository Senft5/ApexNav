// Types for the Workers test pool: `env` from "cloudflare:workers" is our Worker's bindings; `exports.default` is the Worker itself.
import type { Env as AppEnv } from "../src/util";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
  }
}
export {};
