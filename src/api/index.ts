import { PluginEngine } from '../plugin/engine';

let pluginEngineInstance: PluginEngine | null = null;

export function setPluginEngine(engine: PluginEngine) {
  pluginEngineInstance = engine;
}

export function getPluginEngine(): PluginEngine {
  if (!pluginEngineInstance) {
    throw new Error('PluginEngine not initialized');
  }
  return pluginEngineInstance;
}
