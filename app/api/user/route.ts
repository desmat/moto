import { NextRequest, NextResponse } from 'next/server'
import trackEvent from '@/lib/trackEventServer';
import { currentUser, getUser, saveUser } from '@/services/users'

export async function GET(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.user.GET', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const userRecord = await getUser(user.id);

  if (!userRecord) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ user: userRecord });
}

export async function PUT(request: NextRequest) {
  const user = await currentUser();
  console.log('app.api.user.PUT', { user });

  if (!user) {
    return NextResponse.json(
      { success: false, message: 'authorization failed' },
      { status: 403 }
    );
  }

  const existing = await getUser(user.id);

  if (!existing) {
    return NextResponse.json(
      { success: false, message: 'not found' },
      { status: 404 }
    );
  }

  const { user: value } = await request.json();

  // identity fields are pinned to the existing record, everything else is editable
  const updated = await saveUser({
    ...value,
    id: existing.id,
    providerId: existing.providerId,
    createdAt: existing.createdAt,
  });

  await trackEvent("user-updated", {
    userId: user.id,
    userIsAdmin: !!user.publicMetadata?.isAdmin,
  });

  return NextResponse.json({ user: updated });
}
