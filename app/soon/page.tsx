import { Result } from 'antd';

/** Shared placeholder for the categories that have not been built yet. */
export default function ComingSoon() {
  return (
    <Result
      status="info"
      title="Coming soon"
      subTitle="Each category gets its own build cycle, on the same book → pages → review pipeline."
    />
  );
}
