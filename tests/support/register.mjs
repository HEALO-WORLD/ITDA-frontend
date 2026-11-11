/**
 * 저장소 테스트용 Node 모듈 훅 (패키지 추가 설치 없음).
 * 실행: node --import ./tests/support/register.mjs --experimental-test-module-mocks --test "tests/**\/*.test.ts"
 *
 * - `@/...` → `src/...` (tsconfig paths와 같다)
 * - 확장자 없는 상대 경로 → .ts / .tsx / index.ts 순으로 찾는다 (Next·TypeScript 방식)
 * - `.ts`는 Node 기본 타입 제거로 실행하고, `.tsx`는 설치된 typescript로 JSX를 변환한다
 * - `server-only`는 빈 모듈로 바꾼다 (서버 전용 모듈의 순수 로직을 Node에서 확인하기 위해)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "src");
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function findFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const file = findFile(join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const parent = fileURLToPath(context.parentURL);
      if (!parent.includes("node_modules")) {
        const file = findFile(resolvePath(dirname(parent), specifier));
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // exports 맵이 없는 패키지의 하위 경로 (예: next/navigation → next/navigation.js)
      if (error?.code === "ERR_MODULE_NOT_FOUND" && /^[a-z@][^:]*\/[^.]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".tsx")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      const { outputText } = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: false,
        },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
