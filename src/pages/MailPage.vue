<template>
  <q-page padding>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-input v-model="query" dense outlined dark clearable placeholder="Search mail" style="min-width: 260px" @keyup.enter="load">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-space />
      <q-btn flat dense no-caps icon="open_in_new" label="Open Mailpit" @click="openWeb" />
      <q-btn flat dense no-caps icon="content_copy" label="Copy .env" @click="copyEnv" />
      <q-btn flat dense no-caps icon="delete_sweep" label="Clear" color="negative" @click="clearAll" />
      <q-btn flat dense round icon="refresh" :loading="loading" @click="load" />
    </div>

    <q-banner v-if="!running" dense class="bg-grey-9 q-mb-md">
      <template #avatar><q-icon name="mail" /></template>
      The mail service is not running. Every message your apps send is captured here once it starts.
      <template #action>
        <q-btn flat no-caps label="Start mail" @click="startMail" />
      </template>
    </q-banner>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-5">
        <q-card flat class="herd-card">
          <q-list separator dark>
            <q-item
              v-for="message in messages" :key="message.id"
              clickable :active="selected?.id === message.id" @click="openMessage(message)"
            >
              <q-item-section avatar>
                <q-icon :name="message.read ? 'drafts' : 'markunread'" :color="message.read ? 'grey-7' : 'primary'" size="18px" />
              </q-item-section>
              <q-item-section>
                <q-item-label lines="1">{{ message.subject || '(no subject)' }}</q-item-label>
                <q-item-label caption lines="1">{{ message.from }} → {{ message.to.join(', ') }}</q-item-label>
                <q-item-label caption class="text-grey-7">{{ formatDate(message.created) }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="message.attachments" side>
                <q-icon name="attach_file" size="16px" />
              </q-item-section>
            </q-item>
            <q-item v-if="messages.length === 0">
              <q-item-section class="text-grey-6 q-pa-lg text-center">Inbox is empty.</q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

      <div class="col-12 col-md-7">
        <q-card v-if="selected" flat class="herd-card">
          <q-card-section>
            <div class="text-subtitle1">{{ selected.subject || '(no subject)' }}</div>
            <div class="text-caption text-grey-6 q-mt-xs">
              From {{ selected.from?.Address }} · To {{ (selected.to ?? []).map(t => t.Address).join(', ') }}
            </div>
          </q-card-section>
          <q-separator dark />
          <q-tabs v-model="view" dense align="left" no-caps active-color="primary" indicator-color="primary">
            <q-tab name="html" label="HTML" />
            <q-tab name="text" label="Plain text" />
          </q-tabs>
          <q-separator dark />
          <q-tab-panels v-model="view" dark animated>
            <q-tab-panel name="html">
              <!-- Rendered in a sandboxed frame: mail HTML is untrusted input. -->
              <iframe
                ref="frame" sandbox="" class="full-width"
                style="height: 55vh; border: 0; background: #fff; border-radius: 8px"
              />
            </q-tab-panel>
            <q-tab-panel name="text">
              <pre class="herd-log herd-mono">{{ selected.text }}</pre>
            </q-tab-panel>
          </q-tab-panels>
          <q-card-actions>
            <q-btn flat dense no-caps color="negative" icon="delete" label="Delete" @click="remove(selected)" />
          </q-card-actions>
        </q-card>

        <q-card v-else flat class="herd-card">
          <q-card-section class="text-grey-6 text-center q-pa-xl">Select a message to read it.</q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useHerdStore } from 'stores/herd'

defineOptions({ name: 'MailPage' })

const $q = useQuasar()
const store = useHerdStore()

const messages = ref([])
const selected = ref(null)
const query = ref('')
const loading = ref(false)
const view = ref('html')
const frame = ref(null)

const running = computed(() => store.service('mailpit').status === 'running')

async function load () {
  if (!running.value) { messages.value = []; return }
  loading.value = true
  try {
    const data = await store.api.mail.list({ query: query.value ?? '', limit: 100 })
    messages.value = data.messages
  } catch { messages.value = [] } finally { loading.value = false }
}

async function openMessage (message) {
  selected.value = await store.api.mail.get(message.id)
  await store.api.mail.read(message.id, true)
  message.read = true
  await renderHtml()
}

// srcdoc keeps the message isolated from the app's own origin.
async function renderHtml () {
  await nextTick()
  if (frame.value) frame.value.srcdoc = selected.value?.html || '<p style="font-family:sans-serif;padding:16px">No HTML body.</p>'
}

watch(view, v => { if (v === 'html') renderHtml() })

async function remove (message) {
  await store.api.mail.remove(message.id)
  selected.value = null
  await load()
}

function clearAll () {
  $q.dialog({ title: 'Clear mailbox', message: 'Delete every captured message?', cancel: true, dark: true })
    .onOk(async () => { await store.api.mail.clear(); selected.value = null; await load() })
}

async function openWeb () {
  store.api.app.openExternal(await store.api.mail.url())
}

async function copyEnv () {
  store.api.app.copy(await store.api.mail.env())
  $q.notify({ message: 'Mail .env block copied' })
}

async function startMail () {
  await store.api.services.start('mailpit')
  await store.refreshServices()
  await load()
}

function formatDate (value) {
  return value ? new Date(value).toLocaleString() : ''
}

onMounted(load)
watch(running, load)
</script>
