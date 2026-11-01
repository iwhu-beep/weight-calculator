// CI 专用：把版本号与签名配置注入 Capacitor 生成的 Android 工程。
// 原生工程不进仓库（.gitignore 忽略 android/），所以每次构建后都要重新打补丁。
import { readFileSync, writeFileSync } from 'node:fs'

const GRADLE = 'android/app/build.gradle'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

// 1.5.9 → versionName 1.5.9 / versionCode 10509（Android 要求 versionCode 递增才能覆盖安装）
const [major = 0, minor = 0, patch = 0] = pkg.version.split('.').map(n => parseInt(n, 10) || 0)
const versionCode = major * 10000 + minor * 100 + patch

let gradle = readFileSync(GRADLE, 'utf8')
const before = gradle

// 版本号：替换 defaultConfig 里的默认值
gradle = gradle
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`)

// 签名配置：仅在未注入时插入，避免重复执行导致语法错误
if (!gradle.includes('signingConfigs')) {
  gradle = gradle.replace(
    /android \{/,
    `android {
    signingConfigs {
        release {
            // 密码通过环境变量传入，不写进仓库
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
            storeType "PKCS12"
        }
    }`,
  )
  gradle = gradle.replace(
    /(release \{\s*\n)(\s*)(minifyEnabled)/,
    '$1$2signingConfig signingConfigs.release\n$2$3',
  )
}

if (gradle === before) {
  console.error('✗ build.gradle 未被修改，替换规则可能已失效')
  process.exit(1)
}
if (!gradle.includes('signingConfig signingConfigs.release')) {
  console.error('✗ release buildType 未绑定签名配置')
  process.exit(1)
}

writeFileSync(GRADLE, gradle)
console.log(`✓ versionName=${pkg.version} versionCode=${versionCode}，签名配置已注入`)
