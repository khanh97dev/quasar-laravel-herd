<template>
  <q-page padding>
    <div class="row q-col-gutter-md q-mb-md">
      <div v-for="(conn, name) in connections" :key="name" class="col-12 col-sm-6 col-md-3">
        <q-card flat class="herd-card full-height">
          <q-card-section>
            <div class="row items-center">
              <div class="text-subtitle2 text-capitalize">{{ name }}</div>
              <q-space />
              <span class="status-dot" :class="reachable[name] ? 'running' : 'stopped'" />
            </div>
            <div class="herd-mono text-grey-5 q-mt-sm">
              <div v-for="(value, key) in conn" :key="key">{{ key }}: {{ value }}</div>
            </div>
          </q-card-section>
          <q-card-actions>
            <q-btn flat dense no-caps size="sm" label="Copy" @click="copyConn(name, conn)" />
          </q-card-actions>
        </q-card>
      </div>
    </div>

    <q-card flat class="herd-card">
      <q-tabs v-model="tab" dense align="left" no-caps active-color="primary" indicator-color="primary">
        <q-tab name="mysql" label="MySQL" />
        <q-tab name="postgres" label="PostgreSQL" />
      </q-tabs>
      <q-separator dark />

      <q-tab-panels v-model="tab" dark animated>
        <q-tab-panel name="mysql">
          <div class="row items-center q-gutter-sm q-mb-md">
            <q-input v-model="newDatabase" dense outlined dark placeholder="new_database" @keyup.enter="createDatabase" />
            <q-btn unelevated no-caps color="primary" label="Create" :disable="!newDatabase" :loading="creating" @click="createDatabase" />
            <q-space />
            <q-btn flat dense round icon="refresh" :loading="loading" @click="load" />
          </div>
          <q-list separator dark bordered class="rounded-borders">
            <q-item v-for="db in mysqlDatabases" :key="db">
              <q-item-section avatar><q-icon name="storage" size="18px" color="grey-6" /></q-item-section>
              <q-item-section>{{ db }}</q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="delete" color="negative" @click="dropDatabase(db)" />
              </q-item-section>
            </q-item>
            <q-item v-if="mysqlDatabases.length === 0">
              <q-item-section class="text-grey-6">
                {{ reachable.mysql ? 'No databases yet.' : 'MySQL is not running.' }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-tab-panel>

        <q-tab-panel name="postgres">
          <div class="row items-center q-mb-md">
            <q-space />
            <q-btn flat dense round icon="refresh" :loading="loading" @click="load" />
          </div>
          <q-list separator dark bordered class="rounded-borders">
            <q-item v-for="db in postgresDatabases" :key="db">
              <q-item-section avatar><q-icon name="storage" size="18px" color="grey-6" /></q-item-section>
              <q-item-section>{{ db }}</q-item-section>
            </q-item>
            <q-item v-if="postgresDatabases.length === 0">
              <q-item-section class="text-grey-6">
                {{ reachable.postgres ? 'No databases yet.' : 'PostgreSQL is not running.' }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-page>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'DatabasesPage' })

const $q = useQuasar()
const store = useHerdStore()

const tab = ref('mysql')
const connections = ref({})
const reachable = reactive({})
const mysqlDatabases = ref([])
const postgresDatabases = ref([])
const newDatabase = ref('')
const loading = ref(false)
const creating = ref(false)

async function load () {
  loading.value = true
  try {
    connections.value = await store.api.db.connections()
    for (const [name, conn] of Object.entries(connections.value)) {
      const port = conn.port ?? Number(conn.endpoint?.split(':').pop())
      reachable[name] = port ? await store.api.db.ping(port) : false
    }
    mysqlDatabases.value = reachable.mysql ? await store.api.db.mysqlList() : []
    postgresDatabases.value = reachable.postgres ? await store.api.db.postgresList() : []
  } finally { loading.value = false }
}

async function createDatabase () {
  creating.value = true
  try {
    mysqlDatabases.value = await store.api.db.mysqlCreate(newDatabase.value)
    $q.notify({ type: 'positive', message: `Created ${newDatabase.value}` })
    newDatabase.value = ''
  } catch { /* handled */ } finally { creating.value = false }
}

function dropDatabase (name) {
  $q.dialog({
    title: 'Drop database', dark: true, cancel: true,
    message: `Permanently delete "${name}" and everything in it?`
  }).onOk(async () => {
    mysqlDatabases.value = await store.api.db.mysqlDrop(name)
  })
}

function copyConn (name, conn) {
  const text = Object.entries(conn).map(([k, v]) => `${k}=${v}`).join('\n')
  store.api.app.copy(text)
  $q.notify({ message: `${name} connection details copied` })
}

onMounted(load)
</script>
