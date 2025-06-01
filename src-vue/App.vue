<template>
  <div id="app">
    <LogViewer />
  </div>
</template>

<script>
import LogViewer from './components/LogViewer.vue'

export default {
  name: 'App',
  components: {
    LogViewer
  }
}
</script>

<style scoped>
#app {
  height: 100vh;
}
</style>