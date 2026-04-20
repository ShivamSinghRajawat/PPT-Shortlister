import { NextResponse } from 'next/server';
import { evaluatePPT } from '@/lib/ai-service';

export async function GET() {
    try {
        const dummyPPT = {
            text: "Problem: Students struggle to find hackathon teams. Solution: A Tinder-like app for hackers. Tech Stack: React, Firebase, Node.js.",
            images: []
        };

        const dummyBlueprint = {};

        const results = [];
        for (let i = 0; i < 3; i++) { // Run 3 times for extra certainty
            results.push(await evaluatePPT(dummyPPT, dummyBlueprint));
        }

        return NextResponse.json({ success: true, results });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
