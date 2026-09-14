<template>
  <q-page padding>
    <q-banner dense class="bg-grey-9 q-mb-md">
      <template #avatar><q-icon name="bug_report" /></template>
      Add these two lines to a project's <code>.env</code> and every <code>dump()</code> lands here
      instead of in the response body.
      <template #action>
        <q-btn flat dense no-caps label="Copy .env" @click="copyEnv" />
        <q-btn flat dense no-caps :label="serverRunning ? 'Stop server' : 'Start server'" @click="toggleServer" />
      </template>
    </q-banner>

    <div class="row items-center q-gutter-sm q-mb-md">
      <q-input v-model="filter" dense outlined dark clearable placeholder="Filter dumps" style="min-width: 260px">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-space />
      <q-toggle v-model="autoScroll" dense label="Follow new dumps" />
      <q-btn flat dense no-caps icon="delete_sweep" label="Clear" @click="clear" />
    </div>

    <q-card flat class="herd-card">
      <q-list separator dark>
        <q-expansion-item
          v-for="dump in filteredDumps" :key="dump.id"
          dense-toggle switch-toggle-side
        >
          <template #header>
            <q-item-section avatar><q-icon name="chevron_right" size="18px" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label class="herd-mono ellipsis">{{ preview(dump) }}</q-item-label>
              <q-item-label caption>
                {{ new Date(dump.at).toLocaleTimeString() }}
                <template v-if="dump.source"> · {{ dump.source.name }}:{{ dump.source.line }}</template>
              </q-item-label>
            </q-item-section>
          </template>
          <q-card dark flat>
            <q-card-section><pre class="herd-log herd-mono">{{ pretty(dump) }}</pre></q-card-section>
            <q-card-actions>
              <q-btn flat dense no-caps size="sm" label="Copy" @click="store.api.app.copy(pretty(dump))" />
            </q-card-actions>
          </q-card>
        </q-expansion-item>

        <q-item v-if="filteredDumps.length === 0">
          <q-item-section class="text-grey-6 text-center q-pa-xl">
            Nothing captured yet.
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </q-page>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'DumpsPage' })

const $q = useQuasar()
const store = useHerdStore()

const dumps = ref([])
const filter = ref('')
const autoScroll = ref(true)
const serverRunning = ref(true)
let unsubscribe = null

const filteredDumps = computed(() => {
  const needle = filter.value?.toLowerCase().trim()
  if (!needle) return dumps.value
  return dumps.value.filter(d => pretty(d).toLowerCase().includes(needle))
})

function pretty (dump) {
  return typeof dump.raw === 'string' ? dump.raw : JSON.stringify(dump.raw, null, 2)
}

function preview (dump) {
  return pretty(dump).replace(/\s+/g, ' ').slice(0, 120)
}

async function clear () {
  dumps.value = await store.api.dumps.clear()
}

async function copyEnv () {
  store.api.app.copy(await store.api.dumps.env())
  $q.notify({ message: 'Dump server .env block copied' })
}

async function toggleServer () {
  const result = serverRunning.value ? await store.api.dumps.stop() : await store.api.dumps.start()
  serverRunning.value = result.running
}

onMounted(async () => {
  dumps.value = await store.api.dumps.list()
  unsubscribe = store.api.dumps.onDump(entry => {
    if (autoScroll.value) dumps.value.unshift(entry)
  })
})

onUnmounted(() => unsubscribe?.())
</script>
