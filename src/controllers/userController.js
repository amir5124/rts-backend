import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Toast from 'react-native-toast-message';
import "../global.css";

// 1. Variabel bantuan untuk trigger login dari luar (misal: Login.tsx)


export default function RootLayout() {
    const [isLoading, setIsLoading] = useState(true);
    const [userToken, setUserToken] = useState < string | null > (null);

    const segments = useSegments();
    const router = useRouter();

    // 2. Fungsi untuk sinkronisasi token
    const checkToken = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            console.log('Token found:', !!token);
            setUserToken(token);
        } catch (e) {
            console.error("Gagal mengambil token", e);
        } finally {
            // Beri sedikit delay agar transisi tidak terlalu kaget
            setTimeout(() => setIsLoading(false), 500);
        }
    };

    useEffect(() => {
        triggerLoginGlobal = checkToken;
        checkToken();
    }, []);

    // 3. Logika Proteksi Route yang Modern - DIPERBAIKI
    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === '(auth)';
        const inTabsGroup = segments[0] === '(tabs)';
        const inRegisterMitra = segments[1] === 'register-mitra';
        const inPendingReview = segments[1] === 'pending-review';
        const inAuthPages = inRegisterMitra || inPendingReview;

        console.log('Navigation check:', {
            isLoading,
            userToken: !!userToken,
            segments: segments[0],
            inAuthGroup,
            inTabsGroup,
            inAuthPages
        });

        // Jika tidak ada token dan tidak di halaman auth, redirect ke login
        if (!userToken && !inAuthGroup) {
            console.log('Redirect to login - no token');
            router.replace('/(auth)/login');
        }
        // Jika ada token dan sedang di halaman auth (login/register), redirect ke tabs
        else if (userToken && inAuthGroup && !inAuthPages) {
            console.log('Redirect to tabs - user logged in and in auth page');
            router.replace('/(tabs)');
        }
        // Jika ada token dan sedang di halaman tabs, biarkan (tidak perlu redirect)
        else if (userToken && inTabsGroup) {
            console.log('Already in tabs, stay');
        }

        // HAPUS kondisi else yang melakukan redirect ke tabs
    }, [userToken, isLoading, segments]);

    // 4. Loading Screen dengan gaya modern
    if (isLoading) {
        return (
            <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator size="large" color="#FF0000" />
            </View>
        );
    }

    return (
        <>
            <Stack screenOptions={{ headerShown: false }}>
                {/* Pastikan struktur rute sesuai dengan nama folder kamu */}
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

                {/* Halaman Modal / Card untuk UX yang lebih baik */}
                <Stack.Screen
                    name="edit-profile"
                    options={{
                        presentation: 'modal',
                        headerShown: true,
                        title: 'Edit Profil'
                    }}
                />
                <Stack.Screen
                    name="change-password"
                    options={{
                        presentation: 'modal',
                        headerShown: true,
                        title: 'Ganti Kata Sandi'
                    }}
                />
                <Stack.Screen
                    name="payment-intruction"
                    options={{
                        presentation: 'card',
                        headerShown: true,
                        title: 'Instruksi Pembayaran'
                    }}
                />
            </Stack>

            {/* Toast diletakkan paling luar agar selalu muncul di atas rute apa pun */}
            <Toast />
        </>
    );
}