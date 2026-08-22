import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { getCloudBusinessApiBaseUrl } from '../../utils/api';
import './index.scss';

const {
  parseDesktopPairingCode,
  buildPairingConfirmation,
} = require('./runtime');

type Pairing = {
  pairingId: string;
  secret: string;
};

function endpoint(path: string): string {
  return `${getCloudBusinessApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

export default function DesktopOnlineRegistrationPage() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [message, setMessage] = useState('\u8bf7\u5148\u626b\u63cf\u7535\u8111\u4e0a\u663e\u793a\u7684\u4e8c\u7ef4\u7801\u3002');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  const scanDesktopCode = async () => {
    if (busy) return;
    try {
      const result = await Taro.scanCode({ scanType: ['qrCode'] });
      const next = parseDesktopPairingCode(result.result);
      setPairing(next);
      setFinished(false);
      setMessage('\u5df2\u8bc6\u522b\u8fd9\u53f0\u7535\u8111\u3002\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\uff0c\u7528\u5fae\u4fe1\u624b\u673a\u53f7\u5b8c\u6210\u5728\u7ebf\u9a8c\u8bc1\u3002');
    } catch {
      setMessage('\u4e8c\u7ef4\u7801\u65e0\u6548\u3001\u5df2\u8fc7\u671f\u6216\u672a\u80fd\u626b\u63cf\uff0c\u8bf7\u56de\u5230\u7535\u8111\u91cd\u65b0\u751f\u6210\u4e8c\u7ef4\u7801\u3002');
    }
  };

  const confirmWithPhone = async (event: any) => {
    const phoneCode = event?.detail?.code;
    if (!pairing || busy) return;
    setBusy(true);
    setMessage('\u6b63\u5728\u8fdb\u884c\u5728\u7ebf\u9a8c\u8bc1\u2026');
    try {
      const payload = buildPairingConfirmation({
        pairingId: pairing.pairingId,
        pairingSecret: pairing.secret,
        phoneCode,
      });
      const response = await Taro.request({
        url: endpoint('/api/desktop/pairing/confirm'),
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: payload,
        timeout: 30000,
      });
      if (response.statusCode !== 200 || !response.data || (response.data as any).ok !== true) {
        throw new Error('pairing rejected');
      }
      setFinished(true);
      setMessage('\u9a8c\u8bc1\u5b8c\u6210\u3002\u8fd9\u53f0\u7535\u8111\u4f1a\u81ea\u52a8\u7ee7\u7eed\u5b8c\u6210\u5b89\u5168\u767b\u8bb0\uff0c\u8bf7\u56de\u5230\u7535\u8111\u7b49\u5f85\u63d0\u793a\u3002');
    } catch {
      setMessage('\u5728\u7ebf\u9a8c\u8bc1\u672a\u5b8c\u6210\u3002\u8bf7\u786e\u8ba4\u7f51\u7edc\u6b63\u5e38\u540e\u91cd\u8bd5\uff1b\u5982\u4e8c\u7ef4\u7801\u5df2\u8fc7\u671f\uff0c\u8bf7\u56de\u5230\u7535\u8111\u91cd\u65b0\u751f\u6210\u3002');
    } finally {
      setBusy(false);
    }
  };

  return <View className="desktop-online-registration-page">
    <View className="pairing-hero">
      <Text className="pairing-kicker">{'\u683c\u7269\u5de5\u574a \u00b7 \u7535\u8111\u767b\u5f55'}</Text>
      <Text className="pairing-title">{'\u5728\u7ebf\u9a8c\u8bc1\u540e\u81ea\u52a8\u767b\u8bb0'}</Text>
      <Text className="pairing-copy">{'\u65b0\u7535\u8111\u9996\u6b21\u767b\u5f55\u9700\u8981\u8054\u7f51\u9a8c\u8bc1\u3002\u9a8c\u8bc1\u901a\u8fc7\u540e\u4f1a\u81ea\u52a8\u767b\u8bb0\u672c\u673a\uff0c\u4e0d\u9700\u8981\u4eba\u5de5\u5ba1\u6279\u3002'}</Text>
    </View>

    <View className="pairing-card">
      <Text className="pairing-status">{message}</Text>
      {!finished && <>
        <Button className="scan-button" onClick={() => void scanDesktopCode()} disabled={busy}>
          {'\u626b\u63cf\u7535\u8111\u4e8c\u7ef4\u7801'}
        </Button>
        {pairing && <Button
          className="verify-button"
          openType="getPhoneNumber"
          onGetPhoneNumber={(event) => void confirmWithPhone(event)}
          loading={busy}
          disabled={busy}
        >
          {'\u7528\u5fae\u4fe1\u624b\u673a\u53f7\u5728\u7ebf\u9a8c\u8bc1'}
        </Button>}
      </>}
    </View>

    <Text className="pairing-footer">{'\u6ca1\u6709\u7f51\u7edc\u65f6\uff0c\u65b0\u7535\u8111\u4e0d\u80fd\u767b\u5f55\uff1b\u5df2\u767b\u5f55\u7535\u8111\u53ea\u80fd\u7ee7\u7eed\u4f7f\u7528\u672a\u8fc7\u671f\u7684\u672c\u5730\u4f1a\u8bdd\u521b\u5efa\u5f85\u786e\u8ba4\u8349\u7a3f\u3002'}</Text>
  </View>;
}
