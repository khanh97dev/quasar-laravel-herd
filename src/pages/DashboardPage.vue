<template>
  <q-page padding>
    <div v-if="store.firstRun" class="herd-card q-pa-lg q-mb-lg">
      <div class="text-h6 q-mb-sm">Welcome — one step to go</div>
      <p class="text-grey-5">
        No PHP version is installed yet. Install one and Quasar Herd will start
        serving every folder in <code>{{ store.settings.parkedPaths?.[0] }}</code>.
      </p>
      <q-btn color="primary" no-caps unelevated label="Install PHP" :to="{ name: 'php' }" />
    </div>

    <div class="row q-col-gutter-md q-mb-md">
      <div v-for="tile in tiles" :key="tile.label" class="col-12 col-sm-6 col-md-3">
        <q-card flat class="herd-card">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-icon :name="tile.icon" size="30px" :color="tile.color" class="q-mr-md" />
              <div>
                <div class="text-h5 text-weight-medium">{{ tile.value }}</div>
                <div class="text-caption text-grey-6">{{ tile.label }}</div>
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-7">
        <q-card flat class="herd-card">
          <q-card-section class="row items-center">
            <div class="text-subtitle1">Services</div>
            <q-space />
            <q-btn flat dense no-caps size="sm" label="Manage" :to="{ name: 'services' }" />
          </q-card-section>
          <q-separator dark />
          <q-list separator dark>
            <q-item v-for="service in store.services" :key="service.id">
              <q-item-section avatar>
                <span class="status-dot" :class="service.status" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ service.label }}</q-item-label>
                <q-item-label caption>
                  {{ service.status }}<template v-if="service.port"> · port {{ service.port }}</template>
                  <template v-if="service.error"> · {{ service.error }}</template>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn
                  flat dense round
                  :icon="service.status === 'running' ? 'stop' : 'play_arrow'"
                  :color="service.status === 'running' ? 'grey-6' : 'positive'"
                  @click="toggle(service)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

      <div class="col-12 col-md-5">
        <q-card flat class="herd-card">
          <q-card-section class="row items-center">
            <div class="text-subtitle1">Recent sites</div>
            <q-space />
            <q-btn flat dense no-caps size="sm" label="All sites" :to="{ name: 'sites' }" />
          </q-card-section>
          <q-separator dark />
          <q-list separator dark>
            <q-item v-for="site in recentSites" :key="site.domain" clickable @click="open(site)">
              <q-item-section avatar>
                <q-icon :name="site.secure ? 'lock' : 'public'" :color="site.secure ? 'positive' : 'grey-6'" size="18px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ site.domain }}</q-item-label>
                <q-item-label caption class="ellipsis">{{ site.root }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge outline color="grey-7" :label="site.php" />
              </q-item-section>
            </q-item>
            <q-item v-if="recentSites.length === 0">
              <q-item-section class="text-grey-6">No sites yet.</q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <q-card flat class="herd-card q-mt-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">HTTPS</div>
            <div class="row items-center">
              <q-icon
                :name="store.ssl.trusted ? 'verified_user' : 'gpp_maybe'"
                :color="store.ssl.trusted ? 'positive' : 'warning'"
                size="22px" class="q-mr-sm"
              />
              <div class="text-body2">
                {{ store.ssl.trusted ? 'Local CA is trusted by this system.' : 'Local CA is not trusted yet.' }}
              </div>
            </div>
          </q-card-section>
          <q-card-actions v-if="!store.ssl.trusted">
            <q-btn no-caps flat color="primary" label="Trust certificate authority" :loading="trusting" @click="trust" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'DashboardPage' })

const $q = useQuasar()
const store = useHerdStore()
const trusting = ref(false)

const tiles = computed(() => [
  { label: 'Sites', value: store.sites.length, icon: 'language', color: 'primary' },
  { label: 'PHP versions', value: store.phpVersions.length, icon: 'code', color: 'info' },
  { label: 'Services running', value: store.runningCount, icon: 'dns', color: 'positive' },
  { label: 'Secured sites', value: store.securedCount, icon: 'lock', color: 'warning' }
])

const recentSites = computed(() => store.sites.slice(0, 6))

async function toggle (service) {
  if (service.status === 'running') await store.api.services.stop(service.id)
  else await store.api.services.start(service.id)
  await store.refreshServices()
}

function open (site) {
  store.api.app.openExternal(site.url)
}

async function trust () {
  trusting.value = true
  try {
    await store.api.ssl.trust()
    store.ssl = await store.api.ssl.status()
    $q.notify({ type: 'positive', message: 'Certificate authority trusted. Restart your browser to pick it up.' })
  } catch { /* handled */ } finally { trusting.value = false }
}
</script>
