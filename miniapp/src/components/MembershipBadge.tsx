import { Text, View } from '@tarojs/components';

export default function MembershipBadge({ membership }: { membership?: { status?: string } | null }) {
  if (membership?.status !== 'active') return null;
  return <View className='membership-badge'><Text>{'\u4f1a\u5458'}</Text></View>;
}
