import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { Settings, SettingsPatch } from '@shared/types'
import { deepMerge } from '@shared/util'
import { dataPath } from '../paths'
import { Emitter } from './emitter'
import { JsonStore } from './jsonStore'

export class SettingsStore extends Emitter<{ changed: Settings }> {
  private store = new JsonStore<Settings>(
    dataPath('settings.json'),
    () => structuredClone(DEFAULT_SETTINGS),
    // Merging over defaults fills in any settings added in newer versions.
    (raw) => deepMerge(structuredClone(DEFAULT_SETTINGS), raw)
  )

  get data(): Settings {
    return this.store.data
  }

  update(patch: SettingsPatch): Settings {
    this.store.data = deepMerge(this.store.data, patch)
    this.store.save()
    this.emit('changed', this.store.data)
    return this.store.data
  }

  /** Update without notifying renderers (for high-frequency UI bookkeeping like window bounds). */
  updateQuietly(patch: SettingsPatch): void {
    this.store.data = deepMerge(this.store.data, patch)
    this.store.save()
  }

  flush(): void {
    this.store.flush()
  }
}
