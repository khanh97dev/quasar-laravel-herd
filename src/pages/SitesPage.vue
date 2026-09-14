<template>
  <q-page padding>
    <div class="row items-center q-mb-md q-gutter-sm">
      <q-input
        v-model="filter" dense outlined dark clearable
        placeholder="Filter sites" style="min-width: 260px"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-space />
      <q-btn no-caps outline icon="folder_open" label="Park a folder" @click="parkFolder" />
      <q-btn no-caps outline icon="link" label="Link a project" @click="linkFolder" />
      <q-btn no-caps unelevated color="primary" icon="add" label="New site" @click="createDialog = true" />
    </div>

    <q-card v-if="store.settings.parkedPaths?.length" flat class="herd-card q-mb-md">
      <q-card-section class="q-py-sm row items-center">
        <div class="text-caption text-grey-6 q-mr-md">Parked folders</div>
        <q-chip
          v-for="dir in store.settings.parkedPaths" :key="dir"
          dense square removable outline color="grey-7"
          @remove="unpark(dir)"
        >
          {{ dir }}
        </q-chip>
      </q-card-section>
    </q-card>

    <q-table
      flat dark :rows="filteredSites" :columns="columns" row-key="domain"
      :pagination="{ rowsPerPage: 15 }" class="herd-card"
    >
      <template #body-cell-domain="props">
        <q-td :props="props">
          <div class="row items-center no-wrap">
            <q-icon
              :name="props.row.secure ? 'lock' : 'public'"
              :color="props.row.secure ? 'positive' : 'grey-7'"
              size="16px" class="q-mr-sm"
            />
            <a href="#" class="text-primary" @click.prevent="open(props.row)">{{ props.row.domain }}</a>
            <q-badge v-if="props.row.framework" outline color="grey-7" class="q-ml-sm" :label="props.row.framework.name" />
            <q-badge v-if="!props.row.exists" color="negative" class="q-ml-sm" label="missing" />
          </div>
          <div class="text-caption text-grey-7 ellipsis">{{ props.row.root }}</div>
        </q-td>
      </template>

      <template #body-cell-php="props">
        <q-td :props="props">
          <q-select
            dense outlined dark options-dense emit-value map-options
            :model-value="props.row.php"
            :options="phpOptions"
            style="min-width: 110px"
            @update:model-value="version => setPhp(props.row, version)"
          />
        </q-td>
      </template>

      <template #body-cell-secure="props">
        <q-td :props="props">
          <q-toggle
            :model-value="props.row.secure" color="positive" dense
            @update:model-value="secure => setSecure(props.row, secure)"
          />
        </q-td>
      </template>

      <template #body-cell-mode="props">
        <q-td :props="props">
          <q-badge outline :color="props.row.mode === 'linked' ? 'primary' : 'grey-7'" :label="props.row.mode" />
        </q-td>
      </template>

      <template #body-cell-actions="props">
        <q-td :props="props" class="text-right">
          <q-btn flat dense round size="sm" icon="open_in_new" @click="open(props.row)">
            <q-tooltip>Open in browser</q-tooltip>
          </q-btn>
          <q-btn flat dense round size="sm" icon="folder" @click="store.api.app.openPath(props.row.root)">
            <q-tooltip>Open folder</q-tooltip>
          </q-btn>
          <q-btn flat dense round size="sm" icon="code" @click="store.api.tool.openEditor(props.row.root)">
            <q-tooltip>Open in editor</q-tooltip>
          </q-btn>
          <q-btn flat dense round size="sm" icon="more_vert">
            <q-menu dark auto-close>
              <q-list dense style="min-width: 190px">
                <q-item clickable @click="showVhost(props.row)">
                  <q-item-section>View nginx config</q-item-section>
                </q-item>
                <q-item clickable @click="renameSite(props.row)">
                  <q-item-section>Rename</q-item-section>
                </q-item>
                <q-item clickable @click="writeEnv(props.row)">
                  <q-item-section>Write Herd .env values</q-item-section>
                </q-item>
                <q-separator dark />
                <q-item clickable class="text-negative" @click="unlink(props.row)">
                  <q-item-section>Unlink site</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width column flex-center q-pa-xl text-grey-6">
          <q-icon name="language" size="42px" class="q-mb-sm" />
          Park a folder or link a project to get started.
        </div>
      </template>
    </q-table>

    <q-dialog v-model="createDialog">
      <q-card dark style="min-width: 420px">
        <q-card-section class="text-h6">New site</q-card-section>
        <q-card-section class="q-gutter-md">
          <q-input v-model="draft.name" dense outlined dark label="Project name" autofocus />
          <q-select
            v-model="draft.preset" dense outlined dark emit-value map-options
            label="Preset" :options="presets"
          />
          <q-select
            v-model="draft.parent" dense outlined dark
            label="Create inside" :options="store.settings.parkedPaths ?? []"
          />
          <div class="text-caption text-grey-6">
            Will be served at <code>{{ draft.name || 'name' }}.{{ store.tld }}</code>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" v-close-popup />
          <q-btn
            unelevated no-caps color="primary" label="Create"
            :loading="creating" :disable="!draft.name" @click="create"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="vhostDialog">
      <q-card dark style="min-width: 640px; max-width: 90vw">
        <q-card-section class="text-subtitle1">{{ vhostDomain }}</q-card-section>
        <q-card-section>
          <pre class="herd-log herd-mono">{{ vhostText }}</pre>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Copy" @click="store.api.app.copy(vhostText)" />
          <q-btn flat no-caps label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'SitesPage' })

const $q = useQuasar()
const store = useHerdStore()

const filter = ref('')
const createDialog = ref(false)
const creating = ref(false)
const vhostDialog = ref(false)
const vhostText = ref('')
const vhostDomain = ref('')

const draft = reactive({ name: '', preset: 'laravel', parent: null })

const presets = [
  { label: 'Laravel', value: 'laravel' },
  { label: 'Symfony', value: 'symfony' },
  { label: 'Statamic', value: 'statamic' },
  { label: 'Plain PHP', value: 'plain' }
]

const columns = [
  { name: 'domain', label: 'Site', field: 'domain', align: 'left', sortable: true },
  { name: 'php', label: 'PHP', field: 'php', align: 'left' },
  { name: 'type', label: 'Type', field: 'type', align: 'left', sortable: true },
  { name: 'secure', label: 'HTTPS', field: 'secure', align: 'center' },
  { name: 'mode', label: 'Mode', field: 'mode', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' }
]

const phpOptions = computed(() =>
  store.phpVersions.map(v => ({ label: `PHP ${v.version}`, value: v.version })))

const filteredSites = computed(() => {
  const needle = filter.value?.toLowerCase().trim()
  if (!needle) return store.sites
  return store.sites.filter(s =>
    s.domain.toLowerCase().includes(needle) || s.root.toLowerCase().includes(needle))
})

function open (site) {
  store.api.app.openExternal(site.url)
}

async function parkFolder () {
  const dir = await store.api.app.pickDirectory('Choose a folder to park')
  if (!dir) return
  await store.api.sites.park(dir)
  await Promise.all([store.refreshSites(), store.refreshAll()])
  $q.notify({ type: 'positive', message: `Parked ${dir}` })
}

async function unpark (dir) {
  await store.api.sites.unpark(dir)
  await store.refreshAll()
}

async function linkFolder () {
  const dir = await store.api.app.pickDirectory('Choose a project to link')
  if (!dir) return
  await store.api.sites.link(dir, {})
  await store.refreshSites()
  $q.notify({ type: 'positive', message: `Linked ${dir}` })
}

async function create () {
  creating.value = true
  try {
    const site = await store.api.sites.create({
      name: draft.name,
      preset: draft.preset,
      parent: draft.parent ?? undefined
    })
    createDialog.value = false
    draft.name = ''
    await store.refreshSites()
    $q.notify({ type: 'positive', message: `${site.domain} is ready` })
  } catch { /* handled */ } finally { creating.value = false }
}

async function setPhp (site, version) {
  await store.api.sites.setPhp(site.domain, version)
  await store.refreshSites()
}

async function setSecure (site, secure) {
  await store.api.sites.setSecure(site.domain, secure)
  await store.refreshSites()
  if (secure && !store.ssl.trusted) {
    $q.notify({
      type: 'warning',
      message: 'Trust the local certificate authority in Settings for a green padlock.',
      timeout: 7000
    })
  }
}

async function renameSite (site) {
  $q.dialog({
    title: 'Rename site', dark: true, prompt: { model: site.name, type: 'text' }, cancel: true
  }).onOk(async name => {
    await store.api.sites.rename(site.domain, name)
    await store.refreshSites()
  })
}

async function unlink (site) {
  $q.dialog({
    title: 'Unlink site', dark: true, cancel: true,
    message: `Stop serving ${site.domain}? The project files are left untouched.`
  }).onOk(async () => {
    await store.api.sites.unlink(site.domain)
    await store.refreshSites()
  })
}

async function showVhost (site) {
  vhostDomain.value = site.domain
  vhostText.value = await store.api.sites.vhost(site.domain)
  vhostDialog.value = true
}

async function writeEnv (site) {
  const [mailEnv, dumpEnv, connections] = await Promise.all([
    store.api.mail.env(), store.api.dumps.env(), store.api.db.connections()
  ])
  const entries = Object.fromEntries([
    ...mailEnv.split('\n').map(l => l.split('=')),
    ...dumpEnv.split('\n').map(l => l.split('=')),
    ['DB_HOST', connections.mysql.host],
    ['DB_PORT', String(connections.mysql.port)],
    ['DB_USERNAME', connections.mysql.user],
    ['REDIS_HOST', connections.redis.host],
    ['REDIS_PORT', String(connections.redis.port)]
  ].filter(pair => pair.length === 2))

  await store.api.tool.patchEnv(site.root, entries)
  $q.notify({ type: 'positive', message: `.env updated for ${site.domain}` })
}

onMounted(() => {
  draft.parent = store.settings.parkedPaths?.[0] ?? null
})
</script>
