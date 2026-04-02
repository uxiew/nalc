import { dirname, join } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import pc from "picocolors";

import replace from "replace-in";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const [res] = await replace({
  path: "./dist/constant.js",
  request: [
    {
      regex: /__VERSION__/g,
      replace: require(join(__dirname, "package.json")).version,
    },
  ],
});

if (res.isChanged) {
  console.log(
    pc.green("\n+ Version updated, replaced __VERSION__ in dist/constant.js"),
  );
} else {
  throw new Error("Error: Version not updated!");
}
