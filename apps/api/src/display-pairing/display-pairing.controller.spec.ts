import { BadRequestException } from '@nestjs/common';
import { DisplayPairingController } from './display-pairing.controller';

describe('DisplayPairingController', () => {
  const row = { tenantId: 't1', createdById: 'u1', stationId: 's1', role: 'KDS', label: 'Bar tablet' };
  const make = () => {
    const svc: any = { resolveToken: jest.fn(async (t: string) => (t === 'good' ? row : null)) };
    return { svc, ctrl: new DisplayPairingController(svc) };
  };

  it('whoami reads the device token from the X-Device-Token header, so it stays out of URLs', async () => {
    const { svc, ctrl } = make();
    await expect(ctrl.whoami('good', undefined)).resolves.toMatchObject({ tenantId: 't1', stationId: 's1' });
    expect(svc.resolveToken).toHaveBeenCalledWith('good');
  });

  it('whoami still accepts ?token= from a tablet running the older web app; the header wins', async () => {
    const { svc, ctrl } = make();
    await expect(ctrl.whoami(undefined, 'good')).resolves.toMatchObject({ tenantId: 't1' });
    await ctrl.whoami('good', 'other');
    expect(svc.resolveToken).toHaveBeenLastCalledWith('good');
  });

  it('whoami refuses a missing or revoked token', async () => {
    const { ctrl } = make();
    await expect(ctrl.whoami(undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.whoami('revoked', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('draws a QR only for a pairing link', async () => {
    const { ctrl } = make();
    await expect(ctrl.qr({ url: 'https://clerque.cc/pair?code=1234&tenant=cafe' })).resolves.toMatchObject({
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });
    await expect(ctrl.qr({ url: 'https://evil.example/phish' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
