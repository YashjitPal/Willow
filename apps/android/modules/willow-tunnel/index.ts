import { NativeModule, requireNativeModule } from 'expo';

declare class WillowTunnelModule extends NativeModule {
  /**
   * Listens on 127.0.0.1:localPort and pipes every accepted socket to
   * remoteHost:remotePort. Calling it again for the same port with another
   * remote retargets it; with the same remote it does nothing.
   */
  start(localPort: number, remoteHost: string, remotePort: number): Promise<void>;
  stop(localPort: number): Promise<void>;
  stopAll(): Promise<void>;
  /** Removes every WebView cookie (all hosts). Resolves with whether any were removed. */
  clearCookies(): Promise<boolean>;
  /**
   * Runs `script` before the page's own scripts in every document from `origins`,
   * in the WebView mounted under the native view `viewTag`, replacing the one
   * installed there before.
   */
  installDocumentStartScript(
    viewTag: number,
    script: string,
    origins: string[],
  ): Promise<'installed' | 'unsupported' | 'no-webview'>;
}

export default requireNativeModule<WillowTunnelModule>('WillowTunnel');
