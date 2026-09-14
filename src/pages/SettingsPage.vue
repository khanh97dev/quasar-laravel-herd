<template>
  <q-page padding>
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-6">
        <q-card flat class="herd-card">
          <q-card-section class="text-subtitle1">General</q-card-section>
          <q-separator dark />
          <q-card-section class="q-gutter-md">
            <q-input v-model="form.tld" dense outlined dark label="Domain suffix" hint="Sites are served at name.<suffix>" prefix="." />
            <div class="row q-col-gutter-sm">
              <div class="col-6">
                <q-input v-model.number="form.httpPort" type="number" dense outlined dark label="HTTP port" />
              </div>
              <div class="col-6">
                <q-input v-model.number="form.httpsPort" type="number" dense outlined dark label="HTTPS port" />
              </div>
            </div>
            <q-select
              v-model="form.defaultPhp" dense outlined dark emit-value map-options
              label="Default PHP version" :options="phpOptions"
            />
            <q-toggle v-model="form.autoStart" label="Start services when the app launches" />
            <q-toggle v-model="form.startMinimised" label="Start hidden in the tray" />
            <q-toggle v-model="form.secureByDefault" label="Enable HTTPS for new sites" />
          </q-card-section>
          <q-card-actions>
            <q-btn unelevated no-caps color="primary" label="Save" :loading="saving" @click="save" />
            <q-btn flat no-caps label="Reset to defaults" color="negative" @click="reset" />
          </q-card-actions>
        </q-card>

        <q-card flat class="herd-card q-mt-md">
          <q-card-section class="text-subtitle1">Ports</q-card-section>
          <q-separator dark />
          <q-card-section class="q-gutter-md">
            <div v-for="(conf, id) in form.services" :key="id">
              <div class="text-caption text-grey-6 text-capitalize q-mb-xs">{{ id }}</div>
              <div class="row q-col-gutter-sm">
                <div v-for="key in portKeys(conf)" :key="key" class="col">
                  <q-input v-model.number="conf[key]" type="number" dense outlined dark :label="key" />
                </div>
              </div>
            </div>
            <q-input v-model.number="form.dumpServer.port" type="number" dense outlined dark label="Dump server port" />
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-6">
        <q-card flat class="herd-card">
          <q-card-section class="text-subtitle1">HTTPS</q-card-section>
          <q-separator dark />
          <q-card-section>
            <div class="row items-center q-mb-sm">
              <q-icon
                :name="store.ssl.trusted ? 'verified_user' : 'gpp_maybe'"
                :color="store.ssl.trusted ? 'positive' : 'warning'" size="20px" class="q-mr-sm"
              />
              <div>{{ store.ssl.trusted ? 'Trusted by this system' : 'Not trusted yet' }}</div>
            </div>
            <div class="text-caption text-grey-6">
              Trusting the local authority lets browsers accept the certificates Quasar Herd
              issues for your <code>.{{ form.tld }}</code> sites. On Linux, install
              <code>libnss3-tools</code> first so Chrome and Firefox pick it up too.
            </div>
          </q-card-section>
          <q-card-actions>
            <q-btn unelevated no-caps color="primary" label="Trust authority" :loading="trusting" @click="trust" />
            <q-btn flat no-caps label="Remove trust" color="negative" @click="untrust" />
          </q-card-actions>
        </q-card>

        <q-card flat class="herd-card q-mt-md">
          <q-card-section class="row items-center">
            <div class="text-subtitle1">Hosts file</div>
            <q-space />
            <q-btn flat dense no-caps size="sm" label="Re-sync" :loading="syncing" @click="syncHosts" />
          </q-card-section>
          <q-separator dark />
          <q-card-section>
            <div class="text-caption text-grey-6 q-mb-sm herd-mono">{{ hostsPath }}</div>
            <q-chip v-for="domain in hostEntries" :key="domain" dense square outline color="grey-7">{{ domain }}</q-chip>
            <div v-if="hostEntries.length === 0" class="text-grey-6">No managed entries.</div>
          </q-card-section>
          <q-card-actions>
            <q-btn flat no-caps label="Remove all entries" color="negative" @click="removeHosts" />
          </q-card-actions>
        </q-card>

        <q-card flat class="herd-card q-mt-md">
          <q-card-section class="text-subtitle1">About</q-card-section>
          <q-separator dark />
          <q-list dense dark>
            <q-item v-for="(value, key) in about" :key="key">
              <q-item-section>{{ key }}</q-item-section>
              <q-item-section side class="herd-mono text-grey-5">{{ value }}</q-item-section>
            </q-item>
          </q-list>
          <q-card-actions>
            <q-btn flat dense no-caps label="Open data folder" @click="store.api.app.openPath(store.info?.paths?.root)" />
            <q-space />
            <q-btn flat dense no-caps color="negative" label="Quit Quasar Herd" @click="quit" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'SettingsPage' })

const $q = useQuasar()
const store = useHerdStore()

const form = reactive({ services: {}, dumpServer: {} })
const saving = ref(false)
const trusting = ref(false)
const syncing = ref(false)
const hostsPath = ref('')
const hostEntries = ref([])

const phpOptions = computed(() => store.phpVersions.map(v => ({ label: `PHP ${v.version}`, value: v.version })))

const about = computed(() => ({
  Version: store.info?.version,
  Electron: store.info?.electron,
  Node: store.info?.node,
  Platform: `${store.info?.platform} ${store.info?.arch}`,
  'Data folder': store.info?.paths?.root
}))

function portKeys (conf) {
  return Object.keys(conf).filter(k => k.toLowerCase().includes('port'))
}

async function save () {
  saving.value = true
  try {
    await store.saveSettings(JSON.parse(JSON.stringify(form)))
    await store.refreshAll()
    $q.notify({ type: 'positive', message: 'Settings saved' })
  } catch { /* handled */ } finally { saving.value = false }
}

function reset () {
  $q.dialog({ title: 'Reset settings', message: 'Restore every setting to its default?', cancel: true, dark: true })
    .onOk(async () => {
      const defaults = await store.api.settings.reset()
      Object.assign(form, defaults)
      await store.refreshAll()
    })
}

async function trust () {
  trusting.value = true
  try {
    await store.api.ssl.trust()
    store.ssl = await store.api.ssl.status()
    $q.notify({ type: 'positive', message: 'Certificate authority trusted' })
  } catch { /* handled */ } finally { trusting.value = false }
}

async function untrust () {
  await store.api.ssl.untrust()
  store.ssl = await store.api.ssl.status()
}

async function syncHosts () {
  syncing.value = true
  try {
    await store.api.hosts.sync()
    hostEntries.value = await store.api.hosts.entries()
    $q.notify({ type: 'positive', message: 'Hosts file synced' })
  } catch { /* handled */ } finally { syncing.value = false }
}

async function removeHosts () {
  await store.api.hosts.remove()
  hostEntries.value = await store.api.hosts.entries()
}

function quit () {
  $q.dialog({ title: 'Quit', message: 'Stop every service and close Quasar Herd?', cancel: true, dark: true })
    .onOk(() => store.api.app.quit())
}

onMounted(async () => {
  Object.assign(form, JSON.parse(JSON.stringify(store.settings)))
  hostsPath.value = await store.api.hosts.path()
  hostEntries.value = await store.api.hosts.entries()
})
</script>
