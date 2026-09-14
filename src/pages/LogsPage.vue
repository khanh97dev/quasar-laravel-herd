<template>
  <q-page padding>
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-4">
        <q-card flat class="herd-card">
          <q-card-section class="row items-center q-py-sm">
            <div class="text-subtitle2">Log files</div>
            <q-space />
            <q-btn flat dense round size="sm" icon="refresh" :loading="loading" @click="loadList" />
          </q-card-section>
          <q-separator dark />
          <q-list separator dark>
            <q-item
              v-for="entry in files" :key="entry.id"
              clickable :active="active?.id === entry.id" @click="select(entry)"
            >
              <q-item-section avatar>
                <q-icon :name="iconFor(entry.group)" size="18px" color="grey-6" />
              </q-item-section>
              <q-item-section>
                <q-item-label lines="1">{{ entry.label }}</q-item-label>
                <q-item-label caption>{{ formatSize(entry.size) }} · {{ formatDate(entry.modified) }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="files.length === 0">
              <q-item-section class="text-grey-6">No logs yet.</q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

      <div class="col-12 col-md-8">
        <q-card flat class="herd-card">
          <q-card-section class="row items-center q-py-sm q-gutter-sm">
            <div class="text-subtitle2 ellipsis">{{ active?.label ?? 'Select a log' }}</div>
            <q-space />
            <q-input v-model="filter" dense outlined dark clearable placeholder="Filter lines" style="width: 200px" />
            <q-toggle v-model="follow" dense label="Follow" @update:model-value="toggleFollow" />
            <q-btn flat dense round size="sm" icon="delete_sweep" :disable="!active" @click="clear" />
          </q-card-section>
          <q-separator dark />
          <q-card-section>
            <div ref="viewport" class="herd-log herd-mono" style="max-height: 68vh">
              <!-- v-text, not interpolation: the container is pre-wrap, so any
                   formatting whitespace would show up inside the log line. -->
              <div
                v-for="(line, index) in filteredLines" :key="index"
                :class="lineClass(line)" v-text="line"
              />
              <div v-if="filteredLines.length === 0" class="text-grey-7">
                Nothing to show.
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'LogsPage' })

const store = useHerdStore()

const files = ref([])
const active = ref(null)
const lines = ref([])
const filter = ref('')
const follow = ref(true)
const loading = ref(false)
const viewport = ref(null)
let unsubscribe = null

const MAX_LINES = 5000

const filteredLines = computed(() => {
  const needle = filter.value?.toLowerCase().trim()
  return needle ? lines.value.filter(l => l.toLowerCase().includes(needle)) : lines.value
})

function iconFor (group) {
  return { web: 'dns', php: 'code', database: 'storage', site: 'language', application: 'apps' }[group] ?? 'article'
}

function lineClass (line) {
  if (/\b(error|fatal|exception|critical)\b/i.test(line)) return 'text-negative'
  if (/\b(warn|warning|deprecated)\b/i.test(line)) return 'text-warning'
  return 'text-grey-4'
}

async function loadList () {
  loading.value = true
  try { files.value = await store.api.logs.list() } finally { loading.value = false }
}

async function select (entry) {
  if (active.value) await store.api.logs.untail(active.value.id)
  active.value = entry
  const data = await store.api.logs.read(entry.file, 1000)
  lines.value = data.lines
  await toggleFollow(follow.value)
  scrollToBottom()
}

async function toggleFollow (enabled) {
  if (!active.value) return
  if (enabled) await store.api.logs.tail(active.value.id, active.value.file)
  else await store.api.logs.untail(active.value.id)
}

async function clear () {
  await store.api.logs.clear(active.value.file)
  lines.value = []
  await loadList()
}

function scrollToBottom () {
  nextTick(() => {
    if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
  })
}

function formatSize (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatDate (value) {
  return new Date(value).toLocaleString()
}

onMounted(async () => {
  await loadList()
  unsubscribe = store.api.logs.onLine(({ id, line }) => {
    if (id !== active.value?.id) return
    lines.value.push(line)
    // Trimming keeps a chatty log from growing the DOM without bound.
    if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
    if (follow.value) scrollToBottom()
  })
})

onUnmounted(async () => {
  unsubscribe?.()
  if (active.value) await store.api.logs.untail(active.value.id)
})
</script>
