package app.gitvisualizer.events.service;

import java.io.IOException;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.dto.EventsSnapshotResponse;

@Service
public class EventService {

	private final EventQueryService queryService;
	private final EventStreamService streamService;

	public EventService(EventQueryService queryService, EventStreamService streamService) {
		this.queryService = queryService;
		this.streamService = streamService;
	}

	public EventsSnapshotResponse getSnapshot(int limit) {
		return queryService.getSnapshot(limit);
	}

	public SseEmitter subscribeToStream(int replay) throws IOException {
		return streamService.subscribeToStream(replay);
	}
}
