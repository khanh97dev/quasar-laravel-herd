<template>
  <q-layout view="hHh LpR fFf">
    <q-header class="bg-dark-page" bordered>
      <q-toolbar class="q-py-sm">
        <q-avatar square size="28px" class="q-mr-sm">
          <div class="text-primary text-weight-bold" style="font-size: 22px">◆</div>
        </q-avatar>
        <q-toolbar-title class="text-weight-medium">
          Quasar Herd
          <span class="text-caption text-grey-6 q-ml-sm">v{{ store.info?.version ?? '—' }}</span>
        </q-toolbar-title>

        <q-chip
          dense square outline
          :color="store.webRunning ? 'positive' : 'grey-7'"
          :icon="store.webRunning ? 'check_circle' : 'radio_button_unchecked'"
          class="q-mr-sm"
        >
          {{ store.webRunning ? 'Serving' : 'Stopped' }}
        </q-chip>

        <q-btn flat dense no-caps icon="play_arrow" label="Start all" :loading="busy.start" @click="startAll" />
        <q-btn flat dense no-caps icon="stop" label="Stop all" :loading="busy.stop" @click="stopAll" />
        <q-btn flat dense round icon="refresh" :loading="busy.refresh" @click="refresh">
          <q-tooltip>Refresh everything</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer show-if-above :width="216" bordered class="bg-dark">
      <q-list padding>
        <q-item
          v-for="item in nav" :key="item.to"
          v-ripple clickable :to="{ name: item.to }" exact
          active-class="text-primary bg-grey-10"
        >
          <q-item-section avatar><q-icon :name="item.icon" size="20px" /></q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
          <q-item-section v-if="item.badge" side>
            <q-badge :color="item.badgeColor ?? 'grey-8'" :label="item.badge" />
          </q-item-section>
        </q-item>
      </q-list>

      <div class="absolute-bottom q-pa-md text-caption text-grey-7">
        <div>{{ store.phpVersions.length }} PHP · {{ store.sites.length }} sites</div>
        <div>{{ store.info?.platform }} · {{ store.info?.arch }}</div>
      </div>
    </q-drawer>

    <q-page-container>
      <q-banner v-if="store.lastError" dense class="bg-negative text-white">
        <template #avatar><q-icon name="error" /></template>
        {{ store.lastError }}
        <template #action>
          <q-btn flat dense label="Dismiss" @click="store.lastError = null" />
        </template>
      </q-banner>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { computed, onMounted, reactive } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'MainLayout' })

const $q = useQuasar()
const store = useHerdStore()
const busy = reactive({ start: false, stop: false, refresh: false })

const nav = computed(() => [
  { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: 'sites', label: 'Sites', icon: 'language', badge: store.sites.length || null },
  { to: 'php', label: 'PHP', icon: 'code', badge: store.defaultPhp, badgeColor: 'primary' },
  { to: 'services', label: 'Services', icon: 'dns', badge: store.runningCount || null, badgeColor: 'positive' },
  { to: 'databases', label: 'Databases', icon: 'storage' },
  { to: 'mail', label: 'Mail', icon: 'mail' },
  { to: 'dumps', label: 'Dumps', icon: 'bug_report' },
  { to: 'logs', label: 'Logs', icon: 'article' },
  { to: 'console', label: 'Console', icon: 'terminal' },
  { to: 'settings', label: 'Settings', icon: 'settings' }
])

async function startAll () {
  busy.start = true
  try {
    await store.startAll()
    $q.notify({ type: 'positive', message: 'Services started' })
  } catch { /* the bridge already surfaced the error */ } finally { busy.start = false }
}

async function stopAll () {
  busy.stop = true
  try {
    await store.stopAll()
    $q.notify({ message: 'Services stopped' })
  } catch { /* handled */ } finally { busy.stop = false }
}

async function refresh () {
  busy.refresh = true
  try { await store.refreshAll() } finally { busy.refresh = false }
}

onMounted(() => store.init())
</script>
