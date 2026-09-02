<script setup lang="ts">
import type { GroupVerifyConfig } from '@/composables/useAdminSystemConfig'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

withDefaults(defineProps<{
  loading: boolean
  saving: boolean
}>(), {})

const emit = defineEmits<{
  save: []
}>()

const config = defineModel<GroupVerifyConfig>('config', { required: true })
</script>

<template>
  <div class="border border-gray-200 rounded-xl bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-group" />
          QQ群验证
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          启用后，普通用户登录时会通过群机器人接口校验其注册的QQ号是否已加入群，未加群则拒绝登录。
        </p>
      </div>
      <BaseButton
        size="sm"
        :loading="saving"
        :disabled="loading"
        @click="emit('save')"
      >
        保存配置
      </BaseButton>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="space-y-3">
      <BaseSwitch
        v-model="config.enabled"
        label="启用QQ群验证"
      />

      <div class="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        启用前请确认：注册页已要求填写QQ号；未配置验证接口或接口异常时，普通用户将无法登录（管理员不受影响）。
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <BaseInput
          v-model="config.qqGroupNumber"
          label="QQ群号"
          type="text"
          placeholder="例如 123456789"
        />
        <BaseInput
          v-model="config.timeoutMs"
          label="验证超时(毫秒)"
          type="number"
          placeholder="5000"
        />
      </div>
      <BaseInput
        v-model="config.verifyUrl"
        label="群机器人验证接口地址"
        type="text"
        placeholder="http://bot-host/api/check-group-member"
      />
      <BaseInput
        v-model="config.verifyToken"
        label="验证 Token（可留空）"
        type="password"
        placeholder="留空表示无需鉴权"
      />

      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        接口约定：GET 请求，自动附加 <code>qq</code> 与 <code>group</code> 参数；鉴权通过请求头
        <code>Authorization: Bearer &lt;Token&gt;</code>。返回 <code>{"{"} ok: true, data: {"{"} inGroup: true {"}"} {"}"}</code>
        或 <code>{"{"} inGroup: true {"}"}</code> 表示在群内。
      </div>
    </div>
  </div>
</template>
