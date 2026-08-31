'use client';
import { useEffect, useState } from 'react';
import { Card, Col, Empty, Row, Typography } from 'antd';

export default function AssetsPage() {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/assets').then((r) => r.json()).then((d) => setFiles(d.files ?? []));
  }, []);

  return (
    <div>
      <Typography.Title level={4}>Doodle assets</Typography.Title>
      <Typography.Paragraph type="secondary">
        Drop PNGs into <code>assets/doodles</code> to add to this library.
      </Typography.Paragraph>

      {files.length === 0 ? (
        <Empty description="No doodles yet" />
      ) : (
        <Row gutter={[12, 12]}>
          {files.map((f) => (
            <Col key={f} span={4}>
              <Card size="small" cover={
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={`/api/assets?file=${encodeURIComponent(f)}`} alt={f} style={{ background: '#fff' }} />
              }>
                <Card.Meta description={f} />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
