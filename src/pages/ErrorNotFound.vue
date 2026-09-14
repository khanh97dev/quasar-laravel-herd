<template>
  <q-page class="column flex-center">
    <div class="text-h2 text-grey-8">404</div>
    <div class="text-subtitle1 text-grey-6 q-mb-lg">That page does not exist.</div>
    <q-btn unelevated no-caps color="primary" label="Back to dashboard" :to="{ name: 'dashboard' }" />
  </q-page>
</template>

<script setup>
defineOptions({ name: 'ErrorNotFound' })
</script>
