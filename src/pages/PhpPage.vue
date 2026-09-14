<template>
  <q-page padding>
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-5">
        <q-card flat class="herd-card">
          <q-card-section class="row items-center">
            <div class="text-subtitle1">Installed</div>
            <q-space />
            <q-btn flat dense round icon="refresh" size="sm" @click="store.refreshPhp()" />
          </q-card-section>
          <q-separator dark />
          <q-list separator dark>
            <q-item v-for="php in store.phpVersions" :key="php.version" clickable :active="selected === php.version" @click="select(php)">
              <q-item-section avatar>
                <q-icon
                  :name="store.defaultPhp === php.version ? 'star' : 'code'"
                  :color="store.defaultPhp === php.version ? 'primary' : 'grey-7'"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label>PHP {{ php.fullVersion }}</q-item-label>
                <q-item-label caption>
                  {{ php.fpm ? 'FPM' : 'CGI pool' }} · port {{ php.port }}
                  <template v-if="!php.managed"> · system</template>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="more_vert" @click.stop>
                  <q-menu dark auto-close>
                    <q-list dense style="min-width: 180px">
                      <q-item clickable @click="setDefault(php)">
                        <q-item-section>Make default</q-item-section>
                      </q-item>
                      <q-item clickable @click="restart(php)">
                        <q-item-section>Restart pool</q-item-section>
                      </q-item>
                      <q-separator dark />
                      <q-item v-if="php.managed" clickable class="text-negative" @click="uninstall(php)">
                        <q-item-section>Uninstall</q-item-section>
                      </q-item>
                    </q-list>
                  </q-menu>
                </q-btn>
              </q-item-section>
            </q-item>
            <q-item v-if="store.phpVersions.length === 0">
              <q-item-section class="text-grey-6">Nothing installed yet.</q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card flat class="herd-card q-mt-md">
          <q-card-section class="text-subtitle1">Available to install</q-card-section>
          <q-separator dark />
          <q-list separator dark>
            <q-item v-for="version in installable" :key="version">
              <q-item-section>
                <q-item-label>PHP {{ version }}</q-item-label>
                <q-item-label v-if="progress[version]" caption>
                  {{ Math.round((progress[version].percent ?? 0) * 100) }}% downloaded
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn
                  flat dense no-caps size="sm" color="primary" label="Install"
                  :loading="installing === version" @click="install(version)"
                />
              </q-item-section>
              <q-linear-progress
                v-if="progress[version] && installing === version"
                :value="progress[version].percent ?? 0" color="primary" class="absolute-bottom"
              />
            </q-item>
          </q-list>
        </q-card>
      </div>

      <div class="col-12 col-md-7">
        <q-card v-if="selected" flat class="herd-card">
          <q-tabs v-model="tab" dense align="left" active-color="primary" indicator-color="primary" no-caps>
            <q-tab name="ini" label="php.ini" />
            <q-tab name="extensions" label="Extensions" />
            <q-tab name="info" label="Info" />
          </q-tabs>
          <q-separator dark />

          <q-tab-panels v-model="tab" dark animated>
            <q-tab-panel name="ini">
              <div class="row q-col-gutter-sm">
                <div v-for="(value, key) in ini.values" :key="key" class="col-12 col-sm-6">
                  <q-input
                    :model-value="value" :label="key" dense outlined dark
                    @update:model-value="v => ini.values[key] = v"
                  />
                </div>
              </div>
              <div class="row items-center q-mt-md q-gutter-sm">
                <q-btn unelevated no-caps color="primary" label="Save & restart pool" :loading="savingIni" @click="saveIni" />
                <q-btn flat no-caps label="Open file" @click="store.api.app.showItem(ini.file)" />
                <q-space />
                <div class="text-caption text-grey-7 ellipsis">{{ ini.file }}</div>
              </div>
            </q-tab-panel>

            <q-tab-panel name="extensions">
              <q-input v-model="extFilter" dense outlined dark clearable placeholder="Filter extensions" class="q-mb-md">
                <template #prepend><q-icon name="search" /></template>
              </q-input>
              <div class="row q-col-gutter-xs">
                <div v-for="ext in filteredExtensions" :key="ext" class="col-6 col-sm-4">
                  <q-chip dense square outline color="grey-7" class="full-width justify-start">{{ ext }}</q-chip>
                </div>
              </div>
            </q-tab-panel>

            <q-tab-panel name="info">
              <pre class="herd-log herd-mono">{{ phpInfo }}</pre>
              <q-btn flat no-caps label="Reload" class="q-mt-sm" @click="loadInfo" />
            </q-tab-panel>
          </q-tab-panels>
        </q-card>

        <q-card v-else flat class="herd-card">
          <q-card-section class="text-grey-6 text-center q-pa-xl">
            Select a PHP version to configure it.
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'PhpPage' })

const $q = useQuasar()
const store = useHerdStore()

const selected = ref(null)
const tab = ref('ini')
const ini = reactive({ file: '', values: {} })
const extensions = ref([])
const extFilter = ref('')
const phpInfo = ref('')
const installing = ref(null)
const savingIni = ref(false)
const progress = reactive({})
let unsubscribe = null

const installable = computed(() =>
  store.phpAvailable.filter(v => !store.phpVersions.some(p => p.version === v)))

const filteredExtensions = computed(() => {
  const needle = extFilter.value?.toLowerCase().trim()
  return needle ? extensions.value.filter(e => e.toLowerCase().includes(needle)) : extensions.value
})

async function select (php) {
  selected.value = php.version
  const data = await store.api.php.ini(php.version)
  ini.file = data.file
  ini.values = data.values
  extensions.value = await store.api.php.extensions(php.version).catch(() => [])
  phpInfo.value = ''
}

async function loadInfo () {
  const result = await store.api.php.run(selected.value, ['-i'])
  phpInfo.value = result.stdout || result.stderr
}

async function saveIni () {
  savingIni.value = true
  try {
    const data = await store.api.php.saveIni(selected.value, { ...ini.values })
    ini.values = data.values
    $q.notify({ type: 'positive', message: `php.ini saved for ${selected.value}` })
  } catch { /* handled */ } finally { savingIni.value = false }
}

async function install (version) {
  installing.value = version
  try {
    await store.api.php.install(version)
    await store.refreshPhp()
    $q.notify({ type: 'positive', message: `PHP ${version} installed` })
  } catch { /* handled */ } finally { installing.value = null }
}

async function uninstall (php) {
  $q.dialog({
    title: 'Uninstall PHP', dark: true, cancel: true,
    message: `Remove PHP ${php.fullVersion}? Sites using it will fall back to the default version.`
  }).onOk(async () => {
    await store.api.php.uninstall(php.version)
    if (selected.value === php.version) selected.value = null
    await store.refreshPhp()
  })
}

async function setDefault (php) {
  await store.api.php.setDefault(php.version)
  await store.refreshAll()
  $q.notify({ type: 'positive', message: `PHP ${php.version} is now the default` })
}

async function restart (php) {
  await store.api.php.restartPool(php.version)
  $q.notify({ message: `Restarted the PHP ${php.version} pool` })
}

onMounted(() => {
  unsubscribe = store.api.php.onProgress(payload => { progress[payload.version] = payload })
  if (store.phpVersions.length) select(store.phpVersions[0])
})

onUnmounted(() => unsubscribe?.())
</script>
