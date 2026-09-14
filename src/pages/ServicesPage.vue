<template>
  <q-page padding>
    <div class="row q-col-gutter-md">
      <div v-for="service in store.services" :key="service.id" class="col-12 col-sm-6 col-md-4">
        <q-card flat class="herd-card full-height">
          <q-card-section>
            <div class="row items-center no-wrap">
              <span class="status-dot q-mr-sm" :class="service.status" />
              <div class="text-subtitle1">{{ service.label }}</div>
              <q-space />
              <q-badge outline color="grey-7" :label="service.group" />
            </div>
            <div class="text-caption text-grey-6 q-mt-xs">
              {{ service.status }}
              <template v-if="service.port"> · 127.0.0.1:{{ service.port }}</template>
              <template v-if="service.pid"> · pid {{ service.pid }}</template>
            </div>
            <div v-if="service.error" class="text-caption text-negative q-mt-sm">{{ service.error }}</div>
            <q-linear-progress
              v-if="progress[service.id] && !progress[service.id].done"
              :value="progress[service.id].percent ?? 0" color="primary" class="q-mt-sm"
            />
          </q-card-section>

          <q-card-actions>
            <q-btn
              v-if="service.status !== 'running'"
              flat dense no-caps color="positive" icon="play_arrow" label="Start"
              :loading="busy === service.id" @click="act('start', service)"
            />
            <q-btn
              v-else flat dense no-caps color="grey-5" icon="stop" label="Stop"
              :loading="busy === service.id" @click="act('stop', service)"
            />
            <q-btn flat dense no-caps icon="restart_alt" label="Restart" :loading="busy === service.id" @click="act('restart', service)" />
            <q-space />
            <q-btn flat dense no-caps size="sm" label="Install" :loading="busy === service.id" @click="install(service)">
              <q-tooltip>Download the binary for this service</q-tooltip>
            </q-btn>
          </q-card-actions>
        </q-card>
      </div>
    </div>

    <q-card flat class="herd-card q-mt-lg">
      <q-card-section class="row items-center">
        <div class="text-subtitle1">Start automatically</div>
        <q-space />
        <div class="text-caption text-grey-6">Enabled services start with Quasar Herd</div>
      </q-card-section>
      <q-separator dark />
      <q-list separator dark>
        <q-item v-for="(conf, id) in store.settings.services" :key="id">
          <q-item-section>
            <q-item-label class="text-capitalize">{{ id }}</q-item-label>
            <q-item-label caption>
              <template v-for="(value, key) in portFields(conf)" :key="key">{{ key }}: {{ value }} &nbsp;</template>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-toggle
              :model-value="conf.enabled" color="primary" dense
              @update:model-value="enabled => toggleAuto(id, enabled)"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card flat class="herd-card q-mt-md">
      <q-card-section class="row items-center">
        <div class="text-subtitle1">nginx configuration</div>
        <q-space />
        <q-btn flat dense no-caps label="Validate" :loading="testing" @click="testConfig" />
        <q-btn flat dense no-caps label="View" @click="viewConfig" />
      </q-card-section>
      <q-card-section v-if="testResult">
        <q-banner dense :class="testResult.ok ? 'bg-positive' : 'bg-negative'" class="text-white">
          <pre class="herd-mono q-ma-none">{{ testResult.output || 'Configuration is valid.' }}</pre>
        </q-banner>
      </q-card-section>
    </q-card>

    <q-dialog v-model="configDialog">
      <q-card dark style="min-width: 700px; max-width: 92vw">
        <q-card-section class="text-subtitle1">nginx.conf</q-card-section>
        <q-card-section><pre class="herd-log herd-mono">{{ configText }}</pre></q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Copy" @click="store.api.app.copy(configText)" />
          <q-btn flat no-caps label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'ServicesPage' })

const $q = useQuasar()
const store = useHerdStore()

const busy = ref(null)
const testing = ref(false)
const testResult = ref(null)
const configDialog = ref(false)
const configText = ref('')
const progress = reactive({})
let unsubscribe = null

function portFields (conf) {
  return Object.fromEntries(Object.entries(conf).filter(([key]) => key.toLowerCase().includes('port')))
}

async function act (action, service) {
  busy.value = service.id
  try {
    await store.api.services[action](service.id)
    await store.refreshServices()
  } catch { /* handled */ } finally { busy.value = null }
}

async function install (service) {
  busy.value = service.id
  try {
    await store.api.services.install(service.id)
    $q.notify({ type: 'positive', message: `${service.label} installed` })
  } catch { /* handled */ } finally { busy.value = null }
}

async function toggleAuto (id, enabled) {
  const services = { ...store.settings.services, [id]: { ...store.settings.services[id], enabled } }
  await store.saveSettings({ services })
}

async function testConfig () {
  testing.value = true
  try { testResult.value = await store.api.nginx.test() } finally { testing.value = false }
}

async function viewConfig () {
  configText.value = await store.api.nginx.config()
  configDialog.value = true
}

onMounted(() => {
  unsubscribe = store.api.services.onProgress(payload => { progress[payload.id] = payload })
})

onUnmounted(() => unsubscribe?.())
</script>
