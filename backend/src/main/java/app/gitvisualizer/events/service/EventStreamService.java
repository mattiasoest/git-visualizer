package app.gitvisualizer.events.service;

import java.io.IOException;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.dto.EventView;

@Service
public class EventStreamService {

	private final EventBroadcaster broadcaster;
	private final EventReleaseScheduler releaseScheduler;

	public EventStreamService(
			EventBroadcaster broadcaster,
			EventReleaseScheduler releaseScheduler) {
		this.broadcaster = broadcaster;
		this.releaseScheduler = releaseScheduler;
	}

	public SseEmitter subscribeToStream() throws IOException {
		SseEmitter emitter = broadcaster.subscribe();

		List<EventView> replayEvents = releaseScheduler.lastPollBatchViews();
		int windowSeconds = releaseScheduler.remainingWindowSeconds();
		Runnable cancelReplay = releaseScheduler.replayToEmitter(emitter, replayEvents, windowSeconds);
		broadcaster.onDisconnect(emitter, cancelReplay);

		return emitter;
	}
}
