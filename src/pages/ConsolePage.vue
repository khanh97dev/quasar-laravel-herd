<template>
  <q-page padding>
    <q-card flat class="herd-card q-mb-md">
      <q-card-section class="row items-center q-gutter-sm q-py-sm">
        <q-select
          v-model="site" dense outlined dark options-dense emit-value map-options
          label="Project" :options="siteOptions" style="min-width: 220px"
        />
        <q-select
          v-model="php" dense outlined dark options-dense emit-value map-options
          label="PHP" :options="phpOptions" style="min-width: 130px"
        />
        <q-btn-toggle
          v-model="mode" dense no-caps unelevated toggle-color="primary"
          :options="[
            { label: 'Artisan', value: 'artisan' },
            { label: 'Composer', value: 'composer' },
            { label: 'Tinker', value: 'tinker' },
            { label: 'PHP', value: 'php' }
          ]"
        />
        <q-space />
        <q-btn flat dense round icon="delete_sweep" @click="output = ''" />
      </q-card-section>
    </q-card>

    <q-card flat class="herd-card q-mb-md">
      <q-card-section class="q-py-sm">
        <q-input
          v-model="command" dense outlined dark autofocus
          :placeholder="placeholder" :type="mode === 'tinker' ? 'textarea' : 'text'"
          :autogrow="mode === 'tinker'"
          class="herd-mono"
          @keydown.enter.exact.prevent="mode === 'tinker' ? null : execute()"
          @keydown.ctrl.enter.prevent="execute"
        >
          <template #prepend>
            <span class="text-primary herd-mono">{{ prefix }}</span>
          </template>
          <template #append>
            <q-btn flat dense round icon="play_arrow" :loading="running" @click="execute" />
          </template>
        </q-input>
        <div class="text-caption text-grey-7 q-mt-xs">
          {{ mode === 'tinker' ? 'Ctrl+Enter to run' : 'Enter to run' }} · working directory: {{ site || '—' }}
        </div>
      </q-card-section>
    </q-card>

    <q-card flat class="herd-card">
      <q-card-section>
        <pre ref="viewport" class="herd-log herd-mono" style="max-height: 55vh">{{ output || 'Output appears here.' }}</pre>
      </q-card-section>
    </q-card>

    <q-card v-if="history.length" flat class="herd-card q-mt-md">
      <q-card-section class="text-subtitle2 q-py-sm">Recent commands</q-card-section>
      <q-separator dark />
      <q-list dense separator dark>
        <q-item v-for="(item, index) in history" :key="index" clickable @click="replay(item)">
          <q-item-section class="herd-mono ellipsis">{{ item.prefix }} {{ item.command }}</q-item-section>
          <q-item-section side>
            <q-badge :color="item.code === 0 ? 'positive' : 'negative'" :label="`exit ${item.code}`" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'ConsolePage' })

const store = useHerdStore()

const site = ref(null)
const php = ref(null)
const mode = ref('artisan')
const command = ref('')
const output = ref('')
const running = ref(false)
const history = ref([])
const viewport = ref(null)

const siteOptions = computed(() => store.sites.map(s => ({ label: s.domain, value: s.root })))
const phpOptions = computed(() => store.phpVersions.map(v => ({ label: v.version, value: v.version })))

const prefix = computed(() => ({
  artisan: 'php artisan', composer: 'composer', tinker: 'tinker>', php: 'php'
}[mode.value]))

const placeholder = computed(() => ({
  artisan: 'migrate --seed',
  composer: 'require laravel/telescope',
  tinker: 'User::count()',
  php: '-r "echo PHP_VERSION;"'
}[mode.value]))

async function execute () {
  if (!command.value.trim()) return
  if (!site.value && mode.value !== 'php') {
    output.value += '\n! Select a project first.\n'
    return
  }

  running.value = true
  const args = splitArgs(command.value)
  const options = { cwd: site.value, php: php.value }
  output.value += `\n$ ${prefix.value} ${command.value}\n`

  try {
    let result
    if (mode.value === 'artisan') result = await store.api.tool.artisan(args, options)
    else if (mode.value === 'composer') result = await store.api.tool.composer(args, options)
    else if (mode.value === 'tinker') result = await store.api.tool.tinker(command.value, options)
    else result = await store.api.php.run(php.value, args, site.value)

    output.value += (result.stdout || '') + (result.stderr || '')
    history.value.unshift({ prefix: prefix.value, command: command.value, code: result.code, mode: mode.value })
    history.value = history.value.slice(0, 15)
  } catch (err) {
    output.value += `${err.message}\n`
  } finally {
    running.value = false
    nextTick(() => { if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight })
  }
}

/** Minimal argv splitter honouring quotes, so `make:model "My Model"` works. */
function splitArgs (input) {
  return input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(s => s.replace(/^["']|["']$/g, '')) ?? []
}

function replay (item) {
  mode.value = item.mode
  command.value = item.command
}

onMounted(() => {
  site.value = store.sites[0]?.root ?? null
  php.value = store.defaultPhp
})

watch(() => store.sites, sites => { if (!site.value) site.value = sites[0]?.root ?? null })
</script>
