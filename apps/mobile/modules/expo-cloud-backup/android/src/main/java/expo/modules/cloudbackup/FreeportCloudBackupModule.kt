package expo.modules.cloudbackup

import android.content.Context
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.BlockstoreClient
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cloud backup of the Nostr identity (an `nsec` string) via Google Block Store.
 *
 * `StoreBytesData.setShouldBackupToCloud(true)` asks Google to back the bytes up
 * to the user's Google account (end-to-end encrypted), so they restore
 * automatically when the user sets up a new Android device. We store under a
 * fixed key and read it back by the same key.
 */
class FreeportCloudBackupModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: BlockstoreClient
    get() = Blockstore.getClient(context)

  private val key = "uk.trinh.freeport.identity"

  override fun definition() = ModuleDefinition {
    Name("FreeportCloudBackup")

    Function("isAvailable") {
      true
    }

    AsyncFunction("save") { value: String, promise: Promise ->
      try {
        val data = StoreBytesData.Builder()
          .setBytes(value.toByteArray(Charsets.UTF_8))
          .setKey(key)
          .setShouldBackupToCloud(true)
          .build()
        client.storeBytes(data)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject("ERR_CLOUD_SAVE", e.message ?: "storeBytes failed", e) }
      } catch (e: Exception) {
        promise.reject("ERR_CLOUD_SAVE", e.message ?: "storeBytes failed", e)
      }
    }

    AsyncFunction("restore") { promise: Promise ->
      try {
        val request = RetrieveBytesRequest.Builder()
          .setKeys(listOf(key))
          .build()
        client.retrieveBytes(request)
          .addOnSuccessListener { response ->
            val entry = response.blockstoreDataMap[key]
            val bytes = entry?.bytes
            if (bytes == null || bytes.isEmpty()) {
              promise.resolve(null)
            } else {
              promise.resolve(String(bytes, Charsets.UTF_8))
            }
          }
          .addOnFailureListener { e -> promise.reject("ERR_CLOUD_RESTORE", e.message ?: "retrieveBytes failed", e) }
      } catch (e: Exception) {
        promise.reject("ERR_CLOUD_RESTORE", e.message ?: "retrieveBytes failed", e)
      }
    }

    AsyncFunction("clear") { promise: Promise ->
      try {
        val request = DeleteBytesRequest.Builder()
          .setKeys(listOf(key))
          .build()
        client.deleteBytes(request)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject("ERR_CLOUD_CLEAR", e.message ?: "deleteBytes failed", e) }
      } catch (e: Exception) {
        promise.reject("ERR_CLOUD_CLEAR", e.message ?: "deleteBytes failed", e)
      }
    }
  }
}
