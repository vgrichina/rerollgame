// QuickJS sandbox for safe game execution
import { getQuickJS } from 'quickjs-emscripten';

let QuickJS = null;

export async function initQuickJS() {
  if (!QuickJS) {
    QuickJS = await getQuickJS();
  }
  return QuickJS;
}

export function createSandbox() {
  if (!QuickJS) throw new Error('QuickJS not initialized - call initQuickJS() first');

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024); // 16MB heap
  runtime.setMaxStackSize(1024 * 1024); // 1MB stack

  let vm = runtime.newContext();
  let updateHandle = null;
  let disposed = false;

  function wrapCode(code) {
    return `
${code}

function __doUpdate(deltaTime, input) {
  try {
    return update(deltaTime, input);
  } catch (error) {
    return [{ op: "text", x: 10, y: 200, text: "ERROR: " + error.message, fill: "#f44", font: "14px monospace" }];
  }
}
`;
  }

  function jsToQjs(obj) {
    const jsonStr = JSON.stringify(obj);
    const result = vm.evalCode(`(${jsonStr})`);
    if (result.error) {
      result.error.dispose();
      return vm.undefined;
    }
    return result.value;
  }

  function callFunction(name) {
    const handle = vm.getProp(vm.global, name);
    const result = vm.callFunction(handle, vm.undefined);
    handle.dispose();
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`${name}() error: ${JSON.stringify(err)}`);
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    return value;
  }

  return {
    loadGame(code) {
      // Eval game code
      const evalResult = vm.evalCode(wrapCode(code), 'game.js');
      if (evalResult.error) {
        const err = vm.dump(evalResult.error);
        evalResult.error.dispose();
        throw new Error(`Game load error: ${JSON.stringify(err)}`);
      }
      evalResult.dispose();

      // Get update handle for repeated calls
      updateHandle = vm.getProp(vm.global, '__doUpdate');

      // Call metadata() and resources()
      const metadata = callFunction('metadata');
      const resources = callFunction('resources');

      return { metadata, resources };
    },

    callUpdate(dt, input) {
      if (!updateHandle) throw new Error('No game loaded');

      const dtHandle = vm.newNumber(dt);
      const inputHandle = jsToQjs(input);

      // Set interrupt to prevent infinite loops (50ms timeout)
      let start = Date.now();
      runtime.setInterruptHandler(() => Date.now() - start > 50);

      const result = vm.callFunction(updateHandle, vm.undefined, dtHandle, inputHandle);

      dtHandle.dispose();
      inputHandle.dispose();

      // Clear interrupt handler
      runtime.removeInterruptHandler();

      if (result.error) {
        const err = vm.dump(result.error);
        result.error.dispose();
        // Return error as visual command instead of crashing
        return [{ op: 'text', x: 10, y: 200, text: 'ERROR: ' + (err?.message || err), fill: '#f44', font: '14px monospace' }];
      }

      const commands = vm.dump(result.value);
      result.value.dispose();
      return Array.isArray(commands) ? commands : [];
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (updateHandle) {
        updateHandle.dispose();
        updateHandle = null;
      }
      if (vm) {
        vm.dispose();
        vm = null;
      }
      if (runtime) {
        runtime.dispose();
      }
    },
  };
}
